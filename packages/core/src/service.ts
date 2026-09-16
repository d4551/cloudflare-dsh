/**
 * The `ctx.cloudflare` service.
 *
 * Wiring only: the class owns lifecycle and configuration, and delegates every
 * decision to the pure modules and the client. Keeping it thin is what lets
 * the rest of the package be exhaustively tested without a Cordis context.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { type BinaryBody, CloudflareClient, type FetchLike, realSleep } from './client.ts'
import type { CloudflareConfig } from './config.ts'
import type { CredentialResolver } from './credentials.ts'
import { CloudflareError } from './errors.ts'
import {
  nextPageByLength,
  nextPageQuery,
  type NextPageQuery,
  type PageStepper,
  type PageWalk,
} from './paginate.ts'
import { assertSafePath, decodePath } from './request.ts'
import { makeScope, scopedPath } from './scope.ts'
import type { CloudflareEnvelope, JsonValue, RequestSpec, Scope } from './types.ts'

/** One account as returned by `GET /accounts`. */
export interface CloudflareAccount {
  readonly id: string
  readonly name: string
}

/**
 * Whether a parsed item is an account.
 *
 * The list endpoint's element shape is read here rather than declared at the
 * client, because this is the only place that knows what `/accounts` puts in
 * each entry. The intersection with an index-signature object is what lets this
 * be a predicate over a parsed value: `CloudflareAccount` alone carries no
 * index signature, so it is not itself a `JsonValue`.
 */
function isCloudflareAccount(
  value: JsonValue,
): value is CloudflareAccount & { readonly [key: string]: JsonValue } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return typeof value['id'] === 'string' && typeof value['name'] === 'string'
}

/**
 * Raised when the plugin is applied to a context without the credentials
 * service it declares.
 *
 * Cordis supplies the resolver because `inject` names it; a direct caller that
 * skipped the framework would otherwise get a service whose every request fails
 * later, at credential resolution, far from the mistake that caused it.
 */
export class CloudflareMissingCredentialsError extends CloudflareError {
  override readonly name = 'CloudflareMissingCredentialsError'
  constructor() {
    super('the credentials service is required on the context, and was not provided', 0)
  }
}

/** Collaborators the service needs beyond its config. */
export interface CloudflareServiceDeps {
  readonly credentials: CredentialResolver
  readonly fetch: FetchLike
}

/**
 * Largest page `/accounts` will serve.
 *
 * A protocol fact from Cloudflare's schema, not a tunable.
 */
const ACCOUNTS_MAX_PAGE_SIZE = 50

/** Raised when discovery finds more than one account and none was configured. */
export class CloudflareAmbiguousAccountError extends CloudflareError {
  override readonly name = 'CloudflareAmbiguousAccountError'
  constructor(accounts: readonly CloudflareAccount[], truncated: boolean) {
    const named = accounts.map((account) => `${account.id} (${account.name})`).join(', ')
    super(
      'This token can reach more than one Cloudflare account, so discovery cannot choose safely. ' +
        `Set \`accountId\` on the cloudflare plugin. Visible accounts: ${named}` +
        (truncated ? ' — and the list was truncated, so there may be more.' : ''),
      0,
    )
  }
}

/** Raised when no account is configured and none could be discovered. */
export class CloudflareNoAccountError extends CloudflareError {
  override readonly name = 'CloudflareNoAccountError'
  constructor() {
    super(
      'No Cloudflare account is configured and the token has access to none. ' +
        'Set `accountId` in the plugin config.',
      404,
    )
  }
}

/** Raised when the accounts endpoint answers with an entry that is not an account. */
export class CloudflareMalformedAccountError extends CloudflareError {
  override readonly name = 'CloudflareMalformedAccountError'
  constructor() {
    super('the accounts endpoint returned an entry without an id and a name', 0)
  }
}

export class CloudflareService extends Service {
  readonly client: CloudflareClient
  readonly config: CloudflareConfig
  /**
   * Discovered account id, remembered for the life of the plugin instance.
   *
   * Deliberately a TypeScript-private field rather than a `#private` one:
   * Cordis exposes services through a Proxy for context tracing, and native
   * private fields are unreadable through a proxy — `this` is the proxy, not
   * the instance, so `this.#field` throws at runtime.
   */
  private resolvedAccountId: string | undefined

  constructor(ctx: Context, config: CloudflareConfig, deps: CloudflareServiceDeps) {
    super(ctx, 'cloudflare')
    this.config = config
    this.resolvedAccountId = config.accountId === '' ? undefined : config.accountId
    this.client = new CloudflareClient({
      credentials: deps.credentials,
      apiTokenRef: config.apiTokenRef,
      baseUrl: config.baseUrl,
      retry: {
        maxRetries: config.maxRetries,
        baseDelayMs: config.retryBaseDelayMs,
        maxDelayMs: config.retryMaxDelayMs,
      },
      maxPages: config.maxPages,
      requestTimeoutMs: config.requestTimeoutMs,
      fetch: deps.fetch,
      sleep: realSleep,
      random: Math.random,
    })
  }

  /**
   * Every account the token can see, up to the page ceiling; `truncated` says
   * whether the ceiling cut the list. The caller's signal, when given, cancels
   * the walk.
   */
  async listAccounts(signal?: AbortSignal): Promise<{ accounts: CloudflareAccount[]; truncated: boolean }> {
    // `/accounts` is page-numbered, not cursor-paginated. Walking it with the
    // cursor stepper stopped after the first page, and the walk was reported as
    // "every account the token can see".
    const walk = await this.client.listAll(
      { method: 'GET', path: '/accounts', query: { per_page: ACCOUNTS_MAX_PAGE_SIZE }, signal },
      nextPageQuery,
    )
    const accounts = walk.items.filter(isCloudflareAccount)
    // An entry that is not an account would otherwise be dropped in silence,
    // and a shortened list is exactly what makes a second account invisible —
    // which the ambiguity check below exists to catch.
    if (accounts.length !== walk.items.length) throw new CloudflareMalformedAccountError()
    return { accounts, truncated: walk.truncated }
  }

  /**
   * The account id to operate on.
   *
   * Configured value wins. Otherwise the first accessible account is adopted
   * and remembered for the life of the plugin instance — this is discovery,
   * not a credential, so caching it is safe.
   */
  async accountId(signal?: AbortSignal): Promise<string> {
    const known = this.resolvedAccountId
    if (known !== undefined) return known
    const { accounts, truncated } = await this.listAccounts(signal)
    const first = accounts[0]
    if (first === undefined) throw new CloudflareNoAccountError()
    // Adopting one of several accounts silently would point every later request
    // at an account the operator never named — including writes.
    if (accounts.length > 1 || truncated) throw new CloudflareAmbiguousAccountError(accounts, truncated)
    this.resolvedAccountId = first.id
    return first.id
  }

  /** The account scope, resolving the account id if needed, under the caller's signal. */
  async accountScope(signal?: AbortSignal): Promise<Scope> {
    return makeScope(await this.accountId(signal))
  }

  /**
   * The page stepper for endpoints that report no `result_info`: a page
   * shorter than the size asked for is the only sign the data ran out. The
   * Workers AI catalogue walks this way.
   */
  pageByLength(perPage: number): PageStepper {
    return nextPageByLength(perPage)
  }

  /**
   * The next page query for a page-numbered endpoint, read from the
   * envelope's `result_info`: null once everything has been seen, or when the
   * page came back short, or when the endpoint reported nothing to go on.
   */
  nextPage(envelope: Pick<CloudflareEnvelope, 'result_info'>, seen: number): NextPageQuery {
    return nextPageQuery(envelope, seen)
  }

  /**
   * The request path contained to the API root, in both spellings the path
   * denylist must compare: the literal one and the one the server will see
   * after percent-decoding. Containment is this seam's own guarantee, so the
   * pair comes from here rather than from a helper a tool would re-run.
   */
  safeApiPath(path: string): { readonly safe: string; readonly decoded: string } {
    const safe = assertSafePath(path)
    return { safe, decoded: decodePath(safe) }
  }

  /** Issue an account-scoped request, resolving the account id first. */
  async accountRequest(spec: Omit<RequestSpec, 'path'> & { path: string }): Promise<JsonValue> {
    const scope = await this.accountScope(spec.signal)
    return this.client.request({ ...spec, path: scopedPath(scope, spec.path) })
  }

  /**
   * Issue an account-scoped request and keep the whole envelope.
   *
   * `result_info` is where a paged endpoint reports its cursor. `accountRequest`
   * returns only `result`, so a tool that hands its caller a cursor comes here.
   */
  async accountRequestEnvelope(
    spec: Omit<RequestSpec, 'path'> & { path: string },
  ): Promise<CloudflareEnvelope<JsonValue>> {
    const scope = await this.accountScope(spec.signal)
    return this.client.requestEnvelope({ ...spec, path: scopedPath(scope, spec.path) })
  }

  /**
   * Issue an account-scoped request whose response is not an envelope.
   *
   * See `CloudflareClient.requestText` for why a few endpoints need this.
   */
  async accountRequestText(spec: Omit<RequestSpec, 'path'> & { path: string }): Promise<string> {
    const scope = await this.accountScope(spec.signal)
    return this.client.requestText({ ...spec, path: scopedPath(scope, spec.path) })
  }

  /**
   * Issue an account-scoped request whose response is bytes.
   *
   * See `CloudflareClient.requestBytes`.
   */
  async accountRequestBytes(spec: Omit<RequestSpec, 'path'> & { path: string }): Promise<BinaryBody> {
    const scope = await this.accountScope(spec.signal)
    return this.client.requestBytes({ ...spec, path: scopedPath(scope, spec.path) })
  }

  /**
   * Walk every page of an account-scoped list endpoint.
   *
   * Returns the walk's outcome with the items, so a caller can tell a complete
   * result from one the page ceiling cut short.
   */
  async accountListAll(
    spec: Omit<RequestSpec, 'path'> & { path: string },
    step: PageStepper,
  ): Promise<PageWalk<JsonValue>> {
    const scope = await this.accountScope(spec.signal)
    return this.client.listAll({ ...spec, path: scopedPath(scope, spec.path) }, step)
  }
}

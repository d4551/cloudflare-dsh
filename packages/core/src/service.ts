/**
 * The `ctx.cloudflare` service.
 *
 * Wiring only: the class owns lifecycle and configuration, and delegates every
 * decision to the pure modules and the client. Keeping it thin is what lets
 * the rest of the package be exhaustively tested without a Cordis context.
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { CloudflareClient, type FetchLike } from './client.ts'
import type { CloudflareConfig } from './config.ts'
import type { CredentialResolver } from './credentials.ts'
import { CloudflareError } from './errors.ts'
import { nextCursorQuery } from './paginate.ts'
import { makeScope, scopedPath } from './scope.ts'
import type { RequestSpec, Scope, ScopeKind } from './types.ts'

/** One account as returned by `GET /accounts`. */
export interface CloudflareAccount {
  readonly id: string
  readonly name: string
}

/** Collaborators the service needs beyond its config. */
export interface CloudflareServiceDeps {
  readonly credentials: CredentialResolver
  readonly fetch?: FetchLike
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
      fetch: deps.fetch ?? ((request) => fetch(request)),
    })
  }

  /** Every account the token can see. */
  async listAccounts(): Promise<CloudflareAccount[]> {
    return this.client.listAll<CloudflareAccount>(
      { method: 'GET', path: '/accounts', query: { per_page: 50 } },
      nextCursorQuery,
    )
  }

  /**
   * The account id to operate on.
   *
   * Configured value wins. Otherwise the first accessible account is adopted
   * and remembered for the life of the plugin instance — this is discovery,
   * not a credential, so caching it is safe.
   */
  async accountId(): Promise<string> {
    const known = this.resolvedAccountId
    if (known !== undefined) return known
    const accounts = await this.listAccounts()
    const first = accounts[0]
    if (first === undefined) throw new CloudflareNoAccountError()
    this.resolvedAccountId = first.id
    return first.id
  }

  /** The account scope, resolving the account id if needed. */
  async accountScope(): Promise<Scope> {
    return makeScope('account', await this.accountId())
  }

  /** Build a scope of the given kind. */
  scope(kind: ScopeKind, id: string): Scope {
    return makeScope(kind, id)
  }

  /** Issue an account-scoped request, resolving the account id first. */
  async accountRequest<T>(spec: Omit<RequestSpec, 'path'> & { path: string }): Promise<T> {
    const scope = await this.accountScope()
    return this.client.request<T>({ ...spec, path: scopedPath(scope, spec.path) })
  }

  /** Issue a request against an explicit scope. */
  async scopedRequest<T>(scope: Scope, spec: Omit<RequestSpec, 'path'> & { path: string }): Promise<T> {
    return this.client.request<T>({ ...spec, path: scopedPath(scope, spec.path) })
  }
}

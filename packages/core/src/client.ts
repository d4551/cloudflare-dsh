/**
 * The Cloudflare REST client.
 *
 * This is the only module in the package that performs I/O, and it is kept
 * deliberately thin: URL building, header assembly, error classification,
 * retry policy and pagination all live in pure modules it calls. `fetch` is a
 * constructor parameter so the whole class is testable without a network.
 */
import { type CredentialResolver, requireCredential } from './credentials.ts'
import { CloudflareError, classifyFailure } from './errors.ts'
import { type NextPageQuery, paginate } from './paginate.ts'
import { DEFAULT_BASE_URL, buildRequest } from './request.ts'
import { type RetryPolicy, runWithRetry } from './retry.ts'
import { makeScope } from './scope.ts'
import type { CloudflareEnvelope, QueryValue, RequestSpec, Scope } from './types.ts'

/** The `fetch` shape the client needs. */
export type FetchLike = (request: Request) => Promise<Response>

/** Everything the client needs to run. */
export interface CloudflareClientOptions {
  readonly credentials: CredentialResolver
  readonly apiTokenRef: string
  readonly baseUrl?: string
  readonly retry: RetryPolicy
  readonly maxPages: number
  readonly fetch: FetchLike
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/** Recover the HTTP status behind a thrown value, for the retry policy. */
export function statusOfError(error: unknown): number {
  return error instanceof CloudflareError ? error.status : 0
}

/** Default sleep. Exported so its behaviour is directly testable. */
export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Outcome of reading a response body.
 *
 * A tagged union rather than `undefined`, so "the body was not an envelope" is
 * a distinct state the caller must handle rather than something that can be
 * confused with a successfully parsed empty result.
 */
export type EnvelopeRead<T> =
  | { readonly ok: true; readonly envelope: CloudflareEnvelope<T> }
  | { readonly ok: false }

/**
 * Parse a response body as a Cloudflare envelope.
 *
 * An empty or non-JSON body (an edge error page, say) becomes `{ok: false}`
 * rather than a `SyntaxError` thrown from deep inside the client.
 */
export async function readEnvelope<T>(response: Response): Promise<EnvelopeRead<T>> {
  const text = await response.text()
  try {
    return { ok: true, envelope: JSON.parse(text) as CloudflareEnvelope<T> }
  } catch {
    return { ok: false }
  }
}

export class CloudflareClient {
  readonly #options: CloudflareClientOptions
  readonly #baseUrl: string

  constructor(options: CloudflareClientOptions) {
    this.#options = options
    this.#baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  }

  /** The credential reference this client authenticates with. */
  get apiTokenRef(): string {
    return this.#options.apiTokenRef
  }

  /**
   * Send one request and read its envelope, with no retrying.
   *
   * Shared by `request` and `requestEnvelope` so both apply exactly the same
   * failure rules.
   */
  async #send<T>(spec: RequestSpec): Promise<CloudflareEnvelope<T>> {
    const ref = this.#options.apiTokenRef
    const token = await requireCredential(this.#options.credentials, ref)
    const response = await this.#options.fetch(buildRequest({ baseUrl: this.#baseUrl, spec, token }))
    const read = await readEnvelope<T>(response)
    const retryAfter = response.headers.get('retry-after')

    if (!read.ok) {
      throw classifyFailure({ status: response.status, credentialRef: ref, retryAfter })
    }
    // A `success: false` envelope arrives with a 2xx status often enough that
    // the flag has to be checked independently of the HTTP status.
    if (!response.ok || !read.envelope.success) {
      throw classifyFailure({
        status: response.status,
        credentialRef: ref,
        retryAfter,
        envelope: read.envelope,
      })
    }
    return read.envelope
  }

  /** Issue a request, retrying transient failures per the configured policy. */
  async request<T>(spec: RequestSpec): Promise<T> {
    const envelope = await runWithRetry(
      () => this.#send<T>(spec),
      statusOfError,
      this.#options.retry,
      {
        sleep: this.#options.sleep ?? realSleep,
        random: this.#options.random ?? Math.random,
      },
    )
    return envelope.result
  }

  /**
   * Issue a request whose response body is *not* an envelope.
   *
   * A few endpoints return the stored bytes directly — Workers KV value reads,
   * for one — so the envelope contract does not apply. Failures are still
   * classified from the status and any envelope the error path did return.
   */
  async requestText(spec: RequestSpec): Promise<string> {
    const ref = this.#options.apiTokenRef
    const token = await requireCredential(this.#options.credentials, ref)
    const response = await this.#options.fetch(buildRequest({ baseUrl: this.#baseUrl, spec, token }))
    const body = await response.text()
    if (!response.ok) {
      throw classifyFailure({
        status: response.status,
        credentialRef: ref,
        retryAfter: response.headers.get('retry-after'),
      })
    }
    return body
  }

  /** Issue a request and return the whole envelope, for pagination callers. */
  async requestEnvelope<T>(spec: RequestSpec): Promise<CloudflareEnvelope<T>> {
    return this.#send<T>(spec)
  }

  /**
   * Walk a paginated list endpoint, yielding items.
   *
   * The step function decides how the endpoint paginates; see `paginate.ts`.
   */
  list<T>(
    spec: RequestSpec,
    step: (envelope: CloudflareEnvelope<readonly unknown[]>, seen: number) => NextPageQuery,
  ): AsyncGenerator<T, void, undefined> {
    return paginate<T>(
      (query) => {
        const merged: Record<string, QueryValue | undefined> = { ...spec.query, ...query }
        return this.requestEnvelope<readonly T[]>({ ...spec, query: merged })
      },
      step,
      this.#options.maxPages,
    )
  }

  /** Collect every page of a list endpoint into an array. */
  async listAll<T>(
    spec: RequestSpec,
    step: (envelope: CloudflareEnvelope<readonly unknown[]>, seen: number) => NextPageQuery,
  ): Promise<T[]> {
    const items: T[] = []
    for await (const item of this.list<T>(spec, step)) items.push(item)
    return items
  }
}

/** Convenience: build an account scope from a resolved account id. */
export function accountScope(accountId: string): Scope {
  return makeScope('account', accountId)
}

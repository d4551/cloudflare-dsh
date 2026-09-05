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
  /** How long one attempt may run before it is aborted. */
  readonly requestTimeoutMs: number
  readonly fetch: FetchLike
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

/**
 * Recover the HTTP status behind a thrown value, for the retry policy.
 *
 * A transport failure — a reset connection, a DNS blip — arrives as a bare
 * `TypeError` from `fetch` with no status at all. It is the commonest transient
 * failure there is, so it maps onto a retryable status rather than being
 * treated as a permanent error. An `AbortError` is the caller's decision and
 * must never be retried.
 */
export function statusOfError(error: unknown): number {
  if (error instanceof CloudflareError) return error.status
  if (error instanceof TypeError) return TRANSPORT_FAILURE_STATUS
  return 0
}

/**
 * Status stood in for a transport failure that carries none.
 *
 * 503 is the closest true statement: the service could not be reached on this
 * attempt, and the condition is expected to be transient.
 */
export const TRANSPORT_FAILURE_STATUS = 503

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
  return parseEnvelope<T>(await response.text())
}

/**
 * Parse a body already read as text.
 *
 * Split from `readEnvelope` so a caller holding the text — `requestText`, which
 * needs the body whether or not it parsed — can classify a failure from the
 * same envelope rather than from the status alone.
 */
function parseEnvelope<T>(text: string): EnvelopeRead<T> {
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
   * Resolve the API token for one operation.
   *
   * Exposed because some Cloudflare surfaces live on other hosts (an AI
   * Gateway endpoint, for one) and need the same credential without going
   * through this client's request path. Resolution still happens per call, so
   * the no-caching rule holds.
   */
  async resolveToken(): Promise<string> {
    return requireCredential(this.#options.credentials, this.#options.apiTokenRef)
  }

  /**
   * Build one attempt's request, under one deadline.
   *
   * The budget is per attempt, not per operation: a retry gets a fresh one,
   * which is what makes a timeout a transient failure rather than a cap on the
   * whole retried sequence. A caller signal aborts every attempt.
   */
  #buildRequest(spec: RequestSpec, token: string): Request {
    const timeout = AbortSignal.timeout(this.#options.requestTimeoutMs)
    const signal = spec.signal === undefined ? timeout : AbortSignal.any([spec.signal, timeout])
    return new Request(buildRequest({ baseUrl: this.#baseUrl, spec, token }), { signal })
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
    const response = await this.#options.fetch(this.#buildRequest(spec, token))
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
    const response = await this.#options.fetch(this.#buildRequest(spec, token))
    const body = await response.text()
    if (!response.ok) {
      // An error body is still an envelope when the endpoint sends one, and it
      // carries the Cloudflare code — which outranks the status class, so a
      // 10000 here is an auth failure rather than whatever the status implies.
      const read = parseEnvelope(body)
      throw classifyFailure({
        status: response.status,
        credentialRef: ref,
        retryAfter: response.headers.get('retry-after'),
        ...(read.ok ? { envelope: read.envelope } : {}),
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

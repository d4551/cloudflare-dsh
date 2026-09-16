/**
 * Shared fixtures for the Cloudflare client suites.
 *
 * One source for the client construction, the wire payloads and the
 * cancellation-honouring transport, so the behavioural suites assert against
 * the same fixtures instead of copies drifting.
 */
import { CloudflareClient, type FetchLike } from '../../src/client.ts'
import type { CredentialResolver } from '../../src/credentials.ts'
import type { NextPageQuery } from '../../src/paginate.ts'
import type { RetryPolicy } from '../../src/retry.ts'
import type { CloudflareEnvelope, JsonValue } from '../../src/types.ts'

/** The credential reference every fixture client authenticates with. */
export const REF = 'CLOUDFLARE_API_TOKEN'

/** The retry policy every fixture client runs under. */
export const RETRY: RetryPolicy = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 }

/** The request spec the boundary suites issue. */
export const SPEC = { method: 'GET', path: '/accounts/a1/things' } as const

/** Per-test overrides for the fixture client. */
export interface ClientOverrides {
  readonly maxPages: number
  readonly requestTimeoutMs: number
  readonly retryPolicy: RetryPolicy
  readonly credentials: CredentialResolver
  /**
   * The REST root to pin. Left unset, the client applies its own default —
   * which is exactly what the default-base-URL suite asserts.
   */
  readonly baseUrl: string
}

/**
 * A client wired to a recording transport, overridable per test.
 *
 * The sleep resolves immediately: the suites observe retry counts and
 * outcomes, not wall-clock backoff.
 */
export function makeClient(
  fetchImpl: FetchLike,
  over: Partial<ClientOverrides> = {},
): { client: CloudflareClient; requests: Request[] } {
  const requests: Request[] = []
  const retry = over.retryPolicy ?? RETRY
  const client = new CloudflareClient({
    credentials: over.credentials ?? { resolve: () => 'tok' },
    apiTokenRef: REF,
    retry,
    maxPages: over.maxPages ?? 10,
    requestTimeoutMs: over.requestTimeoutMs ?? 30_000,
    fetch: async (req) => {
      requests.push(req)
      return fetchImpl(req)
    },
    sleep: () => Promise.resolve(),
    random: () => 1,
    ...(over.baseUrl === undefined ? {} : { baseUrl: over.baseUrl }),
  })
  return { client, requests }
}

/**
 * A transport that answers `status` for the first `failures` calls, then
 * succeeds with `result`. A `failures` at or above the retry budget keeps the
 * transport failing for the whole run, which is how the budget-exhaustion
 * suites hold the failure up.
 */
export function flakyTransport(status: number, failures: number, result: JsonValue): FetchLike {
  let calls = 0
  return async () => {
    calls += 1
    return calls <= failures
      ? json({ success: false, errors: [], messages: [], result: null }, { status })
      : json(ok(result))
  }
}

/**
 * A transport with a real fetch's cancellation behaviour.
 *
 * A real fetch rejects the moment its signal cancels — immediately for a
 * signal that was already aborted — with the signal's own reason, which is
 * what distinguishes a timeout (`TimeoutError`, transient) from a caller
 * cancelling (`AbortError`, final).
 */
export function honouring(request: Request): Promise<Response> {
  if (request.signal.aborted) return Promise.reject(request.signal.reason)
  return new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
  })
}

/** Build a JSON response carrying one envelope-shaped body. */
export function json(body: object, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

/** Build a success envelope payload. */
export function ok<T>(result: T, info?: CloudflareEnvelope['result_info']): CloudflareEnvelope<T> {
  return info === undefined
    ? { success: true, errors: [], result }
    : { success: true, errors: [], result, result_info: info }
}

/** A cursor stepper for the walk tests: the walk is under test here, not any production stepper. */
export function byCursor(envelope: Pick<CloudflareEnvelope, 'result_info'>): NextPageQuery {
  const cursor = envelope.result_info?.cursor
  return cursor === undefined || cursor === '' ? null : { cursor }
}

import { expect, it } from 'vitest'
import { CloudflareClient } from '../src/client.ts'

/**
 * Cancellation settlement contract at the client boundary.
 *
 * Under a transport with a real fetch's cancellation behaviour — a request
 * rejects the moment its signal cancels — every call the caller cancels
 * mid-flight settles as the cancellation it is. The assertion is the outcome,
 * not a stopwatch: a call that hangs fails by the runner's timeout, and a call
 * that settles as success fails here.
 */
const BATCH = 30

const REF = 'CLOUDFLARE_API_TOKEN'
const retry = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 }
const spec = { method: 'GET', path: '/accounts/a1/things' } as const

function makeClient(fetchImpl: (request: Request) => Promise<Response>): CloudflareClient {
  return new CloudflareClient({
    credentials: { resolve: () => 'tok' },
    apiTokenRef: REF,
    baseUrl: 'https://api.test/client/v4',
    retry,
    maxPages: 10,
    requestTimeoutMs: 30_000,
    fetch: fetchImpl,
    sleep: () => Promise.resolve(),
    random: () => 1,
  })
}

/** A transport with a real fetch's cancellation behaviour. */
function honouring(request: Request): Promise<Response> {
  if (request.signal.aborted) return Promise.reject(request.signal.reason)
  return new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => reject(request.signal.reason), { once: true })
  })
}

it('every mid-flight cancelled call settles as AbortError', async () => {
  const settled = await Promise.all(
    Array.from({ length: BATCH }, () => {
      const controller = new AbortController()
      const client = makeClient(async (request) => {
        controller.abort()
        return honouring(request)
      })
      return client.request({ ...spec, signal: controller.signal }).then(
        () => 'resolved' as const,
        (error: NodeJS.ErrnoException) => error.name,
      )
    }),
  )
  expect(settled).toEqual(Array.from({ length: BATCH }, () => 'AbortError'))
})

import { expect, it } from 'vitest'
import { CloudflareClient } from '../src/client.ts'

/**
 * Signal-fusion contract at the client boundary.
 *
 * The client attaches the caller's signal to every outgoing request and lets
 * the transport enforce it, the way a real fetch rejects at once on a signal
 * that was already cancelled. The assertion is on the wire, not on a clock:
 * the request the transport receives must carry the cancellation, and the
 * settlement must be the signal's own `AbortError`.
 */
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

function ok(): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

it('an already-cancelled signal rides fused onto the outgoing request', async () => {
  const requests: Request[] = []
  const controller = new AbortController()
  controller.abort()
  const client = makeClient(async (request) => {
    requests.push(request)
    return honouring(request).then(() => ok())
  })

  const outcome = await client.request({ ...spec, signal: controller.signal }).then(
    () => 'resolved' as const,
    (error: NodeJS.ErrnoException) => error.name,
  )

  expect(outcome).toBe('AbortError')
  expect(requests).toHaveLength(1)
  expect(requests[0]!.signal.aborted, 'the wire request carries the caller cancellation').toBe(true)
})

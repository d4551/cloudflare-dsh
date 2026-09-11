import { expect, it } from 'vitest'
import { CloudflareClient } from '../src/client.ts'

/**
 * Prompt-rejection contract for an already-cancelled call.
 *
 * A signal aborted before the request was built settles the call from the
 * client's own machinery: no fetch fires, and the rejection carries the
 * signal's own `AbortError`. A regression that parks the call on the request
 * budget fails by the runner's timeout, not by a clock in here.
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

function ok(): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

it('an already-aborted call rejects before any request is sent', async () => {
  let fetched = 0
  const controller = new AbortController()
  controller.abort()
  const client = makeClient(async () => {
    fetched += 1
    return ok()
  })

  const outcome = await client
    .request({ ...spec, signal: controller.signal })
    .then(
      () => 'resolved' as const,
      (error: NodeJS.ErrnoException) => error.name,
    )

  expect(outcome).toBe('AbortError')
  expect(fetched, 'a pre-cancelled call must not reach the network').toBe(0)
})

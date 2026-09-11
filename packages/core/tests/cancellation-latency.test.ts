import { expect, it } from 'vitest'
import { CloudflareClient } from '../src/client.ts'

/**
 * Cancellation settlement contract at the client boundary.
 *
 * A caller signal that cancels mid-flight must settle the call as the
 * cancellation it is — the client hands back no response for a call the caller
 * has already given up on, even when the transport answers anyway. A stall has
 * no clock here to fool: the runner's own timeout fails a call that never
 * settles, and the outcome assertion fails a call that settles as success.
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

function ok(): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

it('no cancelled call resolves, whatever the transport answers', async () => {
  const settled = await Promise.all(
    Array.from({ length: BATCH }, () => {
      const controller = new AbortController()
      const client = makeClient(async () => {
        controller.abort()
        return ok()
      })
      return client
        .request({ ...spec, signal: controller.signal })
        .then(
          () => 'resolved' as const,
          (error: NodeJS.ErrnoException) => error.name,
        )
    }),
  )
  expect(settled).toEqual(Array.from({ length: BATCH }, () => 'AbortError'))
})

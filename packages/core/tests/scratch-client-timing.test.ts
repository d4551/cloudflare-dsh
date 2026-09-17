/**
 * Signal-fusion contract at the client boundary.
 *
 * The client attaches the caller's signal to every outgoing request and lets
 * the transport enforce it, the way a real fetch rejects at once on a signal
 * that was already cancelled. The assertion is on the wire, not on a clock:
 * the request the transport receives must carry the cancellation, and the
 * settlement must be the signal's own `AbortError`.
 *
 * The client and the cancellation-honouring transport come from
 * `support/client-fixture.ts`, and the request recording is the one that
 * fixture does for every client suite rather than a second one written here.
 */
import { expect, it } from 'vitest'
import { honouring, json, makeClient } from './support/client-fixture.ts'

const spec = { method: 'GET', path: '/accounts/a1/things' } as const

it('an already-cancelled signal rides fused onto the outgoing request', async () => {
  const controller = new AbortController()
  controller.abort()
  const { client, requests } = makeClient(
    async (request) =>
      honouring(request).then(() => json({ success: true, errors: [], messages: [], result: [] })),
    { baseUrl: 'https://api.test/client/v4' },
  )

  const outcome = await client.request({ ...spec, signal: controller.signal }).then(
    () => 'resolved' as const,
    (error: NodeJS.ErrnoException) => error.name,
  )

  expect(outcome).toBe('AbortError')
  expect(requests).toHaveLength(1)
  expect(requests[0]!.signal.aborted, 'the wire request carries the caller cancellation').toBe(true)
})

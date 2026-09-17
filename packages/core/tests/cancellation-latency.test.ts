/**
 * Cancellation settlement contract at the client boundary.
 *
 * Under a transport with a real fetch's cancellation behaviour — a request
 * rejects the moment its signal cancels — every call the caller cancels
 * mid-flight settles as the cancellation it is. The assertion is the outcome,
 * not a stopwatch: a call that hangs fails by the runner's timeout, and a call
 * that settles as success fails here.
 *
 * The client, the credential reference, the retry policy and the
 * cancellation-honouring transport all come from `support/client-fixture.ts`,
 * which is where every other client suite takes them from.
 */
import { expect, it } from 'vitest'
import { honouring, makeClient } from './support/client-fixture.ts'

const BATCH = 30

const spec = { method: 'GET', path: '/accounts/a1/things' } as const

it('every mid-flight cancelled call settles as AbortError', async () => {
  const settled = await Promise.all(
    Array.from({ length: BATCH }, () => {
      const controller = new AbortController()
      const { client } = makeClient(
        async (request) => {
          controller.abort()
          return honouring(request)
        },
        { baseUrl: 'https://api.test/client/v4' },
      )
      return client.request({ ...spec, signal: controller.signal }).then(
        () => 'resolved' as const,
        (error: NodeJS.ErrnoException) => error.name,
      )
    }),
  )
  expect(settled).toEqual(Array.from({ length: BATCH }, () => 'AbortError'))
})

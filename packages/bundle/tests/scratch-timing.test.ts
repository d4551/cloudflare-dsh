/**
 * The prompt-abort contract: a call whose signal is already cancelled must
 * resolve as an error promptly, for every tool, instead of hanging until the
 * client default budget expires. The registry reports such a call as
 * ABORTED_BEFORE_DISPATCH; one aborted mid-flight is ABORTED.
 */
import { expect, it } from 'vitest'
import { CASES } from './cases.ts'

/** Milliseconds an already-aborted call may take to report its cancellation. */
const ABORTED_CALL_BUDGET_MS = 5_000

it('every tool: an already-aborted call resolves promptly as an error', async () => {
  const timings: [string, number][] = []
  await Promise.all(
    CASES.map(async ([name, harness, args, respond]) => {
      const controller = new AbortController()
      controller.abort()
      const started = performance.now()
      const h = harness(async () => respond())
      const result = await h.execute(name, args, controller.signal)
      const elapsed = Math.round(performance.now() - started)
      expect(result, name).toMatchObject({ isError: true, error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } } })
      timings.push([name, elapsed])
    }),
  )
  const slowest = timings.toSorted((a, b) => b[1] - a[1])[0]
  expect(slowest?.[1], `slowest aborted call: ${slowest?.[0]}`).toBeLessThanOrEqual(ABORTED_CALL_BUDGET_MS)
})

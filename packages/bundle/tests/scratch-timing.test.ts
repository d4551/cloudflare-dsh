/**
 * The prompt-abort contract: a call whose signal is already cancelled never
 * starts a body. The registry reports such a call as ABORTED_BEFORE_DISPATCH
 * for every tool, whatever its family — one aborted mid-flight is ABORTED, and
 * the walk over that lives beside the cases it drives.
 */
import { expect, it } from 'vitest'
import { CASES } from './cases.ts'

/** Budget for the whole-registry walk; finite so a hung walk still fails. */
const WALK_TIMEOUT_MS = 30_000

it(
  'every tool: an already-aborted call is refused before its body runs',
  { timeout: WALK_TIMEOUT_MS },
  async () => {
    await Promise.all(
      CASES.map(async ([name, harness, args, respond]) => {
        const controller = new AbortController()
        controller.abort()
        const sent: Request[] = []
        const h = harness(async (request) => {
          sent.push(request)
          return respond()
        })
        const result = await h.execute(name, args, controller.signal)
        expect(result, name).toMatchObject({
          isError: true,
          error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } },
        })
        expect(sent, `${name}: a refused call reaches no transport`).toEqual([])
      }),
    )
  },
)

/**
 * The whole-registry cancellation walk: every tool must carry the caller's
 * signal, and a tool with its own budget must apply that budget to the request.
 */
import { describe, expect, it } from 'vitest'
import * as aiTools from '../src/tools/ai/index.ts'
import * as dataTools from '../src/tools/data/index.ts'
import * as webTools from '../src/tools/web.ts'
import { PNG_1X1, envelope, makeHarness } from './harness.ts'
import { CASES } from './cases.ts'

describe('every tool forwards the caller signal to Cloudflare', () => {
  it('covers all 36 tools', () => {
    expect(CASES).toHaveLength(36)
  })

  // `timeoutMs` is declarative: the registry does not interrupt a body, so a
  // tool that ignores `exec.signal` runs to completion however long ago the
  // caller gave up. The request must carry the signal, and the call must end
  // as the cancellation it was. The walk is a loop over the registry rather
  // than a generated case list, so a tool added tomorrow is covered without
  // this file naming it; a failure names its tool through the labelled
  // expectations. Each case owns its controller, harness and closure, so the
  // walk runs the cases concurrently.
  it('every tool: the request follows the signal, and the call is reported aborted', async () => {
    await Promise.all(
      CASES.map(async ([name, harness, args, respond]) => {
        const controller = new AbortController()
        let followed: boolean | undefined
        const h = harness(async (request) => {
          // Cancel while the request is in flight, then ask the request itself.
          controller.abort()
          followed = request.signal.aborted
          return respond()
        })
        const result = await h.execute(name, args, controller.signal)
        expect(followed, name).toBe(true)
        expect(result, name).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
      }),
    )
  })
})

/** Resolve after the client would have aborted a request whose budget is a few milliseconds. */
const afterBudget = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 30)
  })

describe('a tool with its own budget applies it to the request', () => {
  it.each([
    ['cloudflare_ai_run', { model: '@cf/m', input: {} }, { inferenceTimeoutMs: 5 }],
    ['cloudflare_aisearch_chat', { instanceId: 'i', query: 'q' }, { inferenceTimeoutMs: 5 }],
  ])(
    '%s: the request deadline is the inference budget, not the client default',
    async (name, args, config) => {
      let aborted: boolean | undefined
      const h = makeHarness(
        aiTools,
        async (request) => {
          await afterBudget()
          aborted = request.signal.aborted
          return envelope({})
        },
        {},
        config,
      )
      await h.execute(name, args)
      expect(aborted).toBe(true)
    },
  )

  it.each([
    ['cloudflare_browser_render', { url: 'https://x.test', format: 'markdown' }, () => envelope('# x')],
    [
      'cloudflare_browser_screenshot',
      { url: 'https://x.test' },
      () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } }),
    ],
    ['cloudflare_browser_accessibility_tree', { url: 'https://x.test' }, () => envelope({})],
  ])('%s: the request deadline is the render budget, not the client default', async (name, args, respond) => {
    let aborted: boolean | undefined
    const h = makeHarness(
      webTools,
      async (request) => {
        await afterBudget()
        aborted = request.signal.aborted
        return respond()
      },
      {},
      { renderTimeoutMs: 5 },
    )
    await h.execute(name, args)
    expect(aborted).toBe(true)
  })

  it('a tool without a budget of its own keeps the client default', async () => {
    let aborted: boolean | undefined
    const h = makeHarness(dataTools, async (request) => {
      await afterBudget()
      aborted = request.signal.aborted
      return envelope([])
    })
    await h.run('cloudflare_d1_list', {})
    expect(aborted).toBe(false)
  })
})

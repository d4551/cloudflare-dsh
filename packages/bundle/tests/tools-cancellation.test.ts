import { describe, expect, it } from 'vitest'
import * as aiTools from '../src/tools/ai.ts'
import * as dataTools from '../src/tools/data.ts'
import * as metaTools from '../src/tools/meta.ts'
import * as webTools from '../src/tools/web.ts'
import { type Harness, PNG_1X1, envelope, makeHarness } from './harness.ts'

type Fetch = (request: Request) => Promise<Response>

/**
 * Every tool, with arguments that pass its schema and a response its output
 * schema admits, so the only thing that can end the call is the cancellation.
 */
const CASES: [string, (fetchImpl: Fetch) => Harness, Record<string, unknown>, () => Response][] = [
  ['cloudflare_ai_run', (f) => makeHarness(aiTools, f), { model: '@cf/m', input: {} }, () => envelope({})],
  ['cloudflare_ai_models_search', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  ['cloudflare_ai_model_schema', (f) => makeHarness(aiTools, f), { model: '@cf/m' }, () => envelope({})],
  ['cloudflare_aigateway_list', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  ['cloudflare_aigateway_get', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope({})],
  ['cloudflare_aigateway_logs', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope([])],
  [
    'cloudflare_aigateway_log_body',
    (f) => makeHarness(aiTools, f),
    { gatewayId: 'g', logId: 'l', part: 'request' },
    () => envelope({}),
  ],
  ['cloudflare_aigateway_routes', (f) => makeHarness(aiTools, f), { gatewayId: 'g' }, () => envelope([])],
  [
    'cloudflare_aigateway_cost',
    (f) => makeHarness(aiTools, f),
    { view: 'credit-balance' },
    () => envelope({}),
  ],
  [
    'cloudflare_aigateway_session_cost',
    (f) => makeHarness(aiTools, f),
    { gatewayId: 'g', sessionId: 's' },
    () => envelope([]),
  ],
  [
    'cloudflare_aisearch_search',
    (f) => makeHarness(aiTools, f),
    { instanceId: 'i', query: 'q' },
    () => envelope({}),
  ],
  [
    'cloudflare_aisearch_chat',
    (f) => makeHarness(aiTools, f),
    { instanceId: 'i', query: 'q' },
    () => envelope({}),
  ],
  ['cloudflare_aisearch_sync', (f) => makeHarness(aiTools, f), { instanceId: 'i' }, () => envelope({})],
  ['cloudflare_vectorize_index_list', (f) => makeHarness(aiTools, f), {}, () => envelope([])],
  [
    'cloudflare_vectorize_query',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', vector: [1] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_upsert',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', vectors: [{ id: 'a', values: [1] }] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_delete',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', ids: ['a'] },
    () => envelope({}),
  ],
  [
    'cloudflare_vectorize_get',
    (f) => makeHarness(aiTools, f),
    { indexName: 'i', ids: ['a'] },
    () => envelope({}),
  ],
  ['cloudflare_kv_namespace_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  ['cloudflare_kv_list_keys', (f) => makeHarness(dataTools, f), { namespaceId: 'n' }, () => envelope([])],
  [
    'cloudflare_kv_get',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', key: 'k' },
    () => new Response('v', { status: 200 }),
  ],
  [
    'cloudflare_kv_put',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', entries: [{ key: 'k', value: 'v' }] },
    () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }),
  ],
  [
    'cloudflare_kv_delete',
    (f) => makeHarness(dataTools, f),
    { namespaceId: 'n', keys: ['k'] },
    () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }),
  ],
  ['cloudflare_d1_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  [
    'cloudflare_d1_query',
    (f) => makeHarness(dataTools, f),
    { databaseId: 'd', sql: 'select 1' },
    () => envelope([]),
  ],
  ['cloudflare_queue_list', (f) => makeHarness(dataTools, f), {}, () => envelope([])],
  [
    'cloudflare_queue_send',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q', body: 'x' },
    () => envelope(null),
  ],
  [
    'cloudflare_queue_pull',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q' },
    () => envelope({ messages: [] }),
  ],
  [
    'cloudflare_queue_ack',
    (f) => makeHarness(dataTools, f),
    { queueId: 'q', acks: ['a'] },
    () => envelope(null),
  ],
  ['cloudflare_r2_bucket_list', (f) => makeHarness(dataTools, f), {}, () => envelope({ buckets: [] })],
  ['cloudflare_r2_bucket_create', (f) => makeHarness(dataTools, f), { name: 'b' }, () => envelope({})],
  [
    'cloudflare_browser_render',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test', format: 'markdown' },
    () => envelope('# x'),
  ],
  [
    'cloudflare_browser_screenshot',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test' },
    () => new Response(PNG_1X1, { status: 200, headers: { 'content-type': 'image/png' } }),
  ],
  [
    'cloudflare_browser_accessibility_tree',
    (f) => makeHarness(webTools, f),
    { url: 'https://x.test' },
    () => envelope({}),
  ],
  ['cloudflare_account_list', (f) => makeHarness(metaTools, f), {}, () => envelope([{ id: 'a', name: 'A' }])],
  [
    'cloudflare_api',
    (f) => makeHarness(metaTools, f),
    { method: 'GET', path: '/zones' },
    () => envelope(null),
  ],
]

describe('every tool forwards the caller signal to Cloudflare', () => {
  it('covers all 36 tools', () => {
    expect(CASES).toHaveLength(36)
  })

  // `timeoutMs` is declarative: the registry does not interrupt a body, so a
  // tool that ignores `exec.signal` runs to completion however long ago the
  // caller gave up. The request must carry the signal, and the call must end
  // as the cancellation it was.
  it.each(CASES)(
    '%s: the request follows the signal, and the call is reported aborted',
    async (name, harness, args, respond) => {
      const controller = new AbortController()
      let followed: boolean | undefined
      const h = harness(async (request) => {
        // Cancel while the request is in flight, then ask the request itself.
        controller.abort()
        followed = request.signal.aborted
        return respond()
      })
      const result = await h.execute(name, args, controller.signal)
      expect(followed).toBe(true)
      expect(result).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
    },
  )
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

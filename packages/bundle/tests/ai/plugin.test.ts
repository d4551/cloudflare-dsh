/**
 * The AI plugin's composition surface: identity, the registered tool set, and
 * the configuration contract every tool reads its defaults from.
 */
import { describe, expect, it } from 'vitest'
import * as aiTools from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('ai plugin shape', () => {
  it('declares its name and injections', () => {
    expect(aiTools.name).toBe('cloudflare-tools-ai')
    expect(aiTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers the full AI tool set', () => {
    const h = makeHarness(aiTools, async () => envelope(null))
    expect(h.names().toSorted()).toEqual([
      'cloudflare_ai_model_schema',
      'cloudflare_ai_models_search',
      'cloudflare_ai_run',
      'cloudflare_aigateway_cost',
      'cloudflare_aigateway_get',
      'cloudflare_aigateway_list',
      'cloudflare_aigateway_log_body',
      'cloudflare_aigateway_logs',
      'cloudflare_aigateway_routes',
      'cloudflare_aigateway_session_cost',
      'cloudflare_aisearch_chat',
      'cloudflare_aisearch_search',
      'cloudflare_aisearch_sync',
      'cloudflare_vectorize_delete',
      'cloudflare_vectorize_get',
      'cloudflare_vectorize_index_list',
      'cloudflare_vectorize_query',
      'cloudflare_vectorize_upsert',
    ])
  })

  it.each([
    ['cloudflare_ai_models_search', {}],
    ['cloudflare_ai_model_schema', { model: '@cf/m' }],
    ['cloudflare_aigateway_list', {}],
    ['cloudflare_aigateway_get', { gatewayId: 'g' }],
    ['cloudflare_aigateway_logs', { gatewayId: 'g' }],
    ['cloudflare_aigateway_log_body', { gatewayId: 'g', logId: 'l', part: 'request' }],
    ['cloudflare_aigateway_routes', { gatewayId: 'g' }],
    ['cloudflare_aigateway_cost', { view: 'credit-balance' }],
    ['cloudflare_aigateway_session_cost', { gatewayId: 'g', sessionId: 's' }],
    ['cloudflare_aisearch_search', { instanceId: 'i', query: 'q' }],
    ['cloudflare_vectorize_index_list', {}],
    ['cloudflare_vectorize_query', { indexName: 'i', vector: [0.1] }],
    ['cloudflare_vectorize_get', { indexName: 'i', ids: ['a'] }],
  ])('marks %s as concurrency safe', (name, args) => {
    const h = makeHarness(aiTools, async () => envelope(null))
    expect(h.tool(name).isConcurrencySafe?.(args)).toBe(true)
  })

  it.each(['cloudflare_ai_run', 'cloudflare_aisearch_chat', 'cloudflare_aisearch_sync'])(
    'leaves %s exclusive',
    (name) => {
      const h = makeHarness(aiTools, async () => envelope(null))
      expect(h.tool(name).isConcurrencySafe).toBeUndefined()
    },
  )

  it('gives inference tools a generous timeout', () => {
    const h = makeHarness(aiTools, async () => envelope(null))
    expect(h.tool('cloudflare_ai_run').timeoutMs).toBe(120_000)
    expect(h.tool('cloudflare_aisearch_chat').timeoutMs).toBe(120_000)
  })
})

describe('page numbers are refused before the first, on every page-numbered tool', () => {
  // Four of the five called `requestedPage`; `cloudflare_aigateway_logs` read
  // `args.page ?? 1` and put `page=0` on the wire. Every one is asserted here,
  // so the next tool to skip the check has a test to fail.
  it.each([
    ['cloudflare_ai_models_search', {}],
    ['cloudflare_aigateway_list', {}],
    ['cloudflare_aigateway_logs', { gatewayId: 'gw1' }],
  ])('%s refuses a page before the first without a request', async (name, args) => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await expect(h.run(name, { ...args, page: 0 })).rejects.toThrow('page must be 1 or more, got 0')
    expect(h.requests).toHaveLength(0)
  })
})

describe('AiToolsConfig', () => {
  it('defaults every tunable the tools used to hard-code', () => {
    expect(aiTools.Config({})).toStrictEqual({
      pageSize: 50,
      searchMaxResults: 10,
      vectorTopK: 5,
      inferenceTimeoutMs: 120_000,
    })
  })

  it('rejects a zero budget at configuration time', () => {
    expect(() => aiTools.Config({ inferenceTimeoutMs: 0 })).toThrow(
      '$.inferenceTimeoutMs expected number >= 1 but got 0',
    )
  })

  it('applies a configured page size to the model catalogue', async () => {
    const h = makeHarness(aiTools, async () => envelope([]), {}, { pageSize: 7 })
    await h.run('cloudflare_ai_models_search', {})
    expect(h.requests[0]!.url).toContain('per_page=7')
  })

  it('applies a configured inference budget to the tools that wait on a model', () => {
    const h = makeHarness(aiTools, async () => envelope(null), {}, { inferenceTimeoutMs: 9_000 })
    expect(h.tool('cloudflare_ai_run').timeoutMs).toBe(9_000)
  })

  it('states the configured default in the parameter description the model reads', () => {
    const h = makeHarness(aiTools, async () => envelope([]), {}, { vectorTopK: 3 })
    expect(h.tool('cloudflare_vectorize_query').parameters).toMatchObject({
      properties: { topK: { description: 'How many matches to return (default 3).' } },
    })
  })
})

import { describe, expect, it } from 'vitest'
import * as aiTools from '../src/tools/ai.ts'
import { envelope, failure, makeHarness } from './harness.ts'

describe('ai plugin shape', () => {
  it('declares its name and injections', () => {
    expect(aiTools.name).toBe('cloudflare-tools-ai')
    expect(aiTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers the full AI tool set', () => {
    const h = makeHarness(aiTools, async () => envelope(null))
    expect([...h.tools.keys()].sort()).toEqual([
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
      'cloudflare_vectorize_index_list',
      'cloudflare_vectorize_query',
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

describe('cloudflare_ai_run', () => {
  it('runs a model and returns its output', async () => {
    const h = makeHarness(aiTools, async () => envelope({ response: 'hi' }))
    await expect(
      h.run('cloudflare_ai_run', { model: '@cf/meta/llama-3.1-8b-instruct', input: { prompt: 'x' } }),
    ).resolves.toEqual({ model: '@cf/meta/llama-3.1-8b-instruct', output: { response: 'hi' } })
  })

  it('posts to the account-scoped run path with the slug preserved', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', { model: '@cf/meta/m', input: {} })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/run/%40cf/meta/m')
  })

  it('sends the input as the request body', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', { model: '@cf/m', input: { prompt: 'x' } })
    await expect(h.requests[0]!.text()).resolves.toBe('{"prompt":"x"}')
  })

  it('renders the model output as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_ai_run').output.render({ model: 'm', input: {} }, { model: 'm', output: { a: 1 } }),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })

  it('surfaces a model error', async () => {
    const h = makeHarness(aiTools, async () => failure(5006, 'model not found', 404))
    await expect(h.run('cloudflare_ai_run', { model: '@cf/nope', input: {} })).rejects.toThrow('model not found')
  })
})

describe('model catalogue tools', () => {
  it('searches models with the default page size', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: '@cf/m' }]))
    await expect(h.run('cloudflare_ai_models_search', {})).resolves.toEqual({ models: [{ name: '@cf/m' }] })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/models/search?per_page=50')
  })

  it('passes search and task filters', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_ai_models_search', { search: 'llama', task: 'Text Generation', perPage: 5 })
    const url = h.requests[0]!.url
    expect(url).toContain('search=llama')
    expect(url).toContain('task=Text+Generation')
    expect(url).toContain('per_page=5')
  })

  it('renders a model count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.tool('cloudflare_ai_models_search').output.render({}, { models: [{}, {}] })).toEqual([
      { type: 'text', text: expect.stringContaining('2 models') },
    ])
  })

  it('fetches a model schema', async () => {
    const h = makeHarness(aiTools, async () => envelope({ type: 'object' }))
    await expect(h.run('cloudflare_ai_model_schema', { model: '@cf/m' })).resolves.toEqual({
      model: '@cf/m',
      schema: { type: 'object' },
    })
    expect(h.requests[0]!.url).toContain('/ai/models/schema?model=%40cf%2Fm')
  })

  it('renders the model schema as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_ai_model_schema').output.render({ model: 'm' }, { model: 'm', schema: { a: 1 } }),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })
})

describe('gateway tools', () => {
  it('lists gateways with the default page size', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'gw1' }]))
    await expect(h.run('cloudflare_aigateway_list', {})).resolves.toEqual({ gateways: [{ id: 'gw1' }] })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai-gateway/gateways?per_page=50')
  })

  it('renders a gateway count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.tool('cloudflare_aigateway_list').output.render({}, { gateways: [{}] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 gateway') },
    ])
  })

  it('fetches one gateway', async () => {
    const h = makeHarness(aiTools, async () => envelope({ id: 'gw1' }))
    await expect(h.run('cloudflare_aigateway_get', { gatewayId: 'gw1' })).resolves.toEqual({
      gateway: { id: 'gw1' },
    })
  })

  it('renders a gateway config as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.tool('cloudflare_aigateway_get').output.render({ gatewayId: 'g' }, { gateway: { id: 'g' } })).toEqual([
      { type: 'text', text: '{\n  "id": "g"\n}' },
    ])
  })

  it('queries logs with the default page size', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'l1' }]))
    await expect(h.run('cloudflare_aigateway_logs', { gatewayId: 'gw1' })).resolves.toEqual({
      logs: [{ id: 'l1' }],
    })
    expect(h.requests[0]!.url).toContain('per_page=50')
  })

  it('passes metadata filters into the log query', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_logs', {
      gatewayId: 'gw1',
      filters: { 'metadata.sessionId': 's1' },
    })
    expect(h.requests[0]!.url).toContain('metadata.sessionId=s1')
  })

  it('renders a log count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.tool('cloudflare_aigateway_logs').output.render({ gatewayId: 'g' }, { logs: [{}] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 log entry') },
    ])
  })

  it.each(['request', 'response'] as const)('fetches a stored %s body', async (part) => {
    const h = makeHarness(aiTools, async () => envelope({ body: 1 }))
    await expect(
      h.run('cloudflare_aigateway_log_body', { gatewayId: 'gw1', logId: 'l1', part }),
    ).resolves.toEqual({ body: { body: 1 } })
    expect(h.requests[0]!.url).toBe(`https://api.test/v4/accounts/a1/ai-gateway/gateways/gw1/logs/l1/${part}`)
  })

  it('renders a stored body as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_aigateway_log_body').output.render(
        { gatewayId: 'g', logId: 'l', part: 'request' },
        { body: { a: 1 } },
      ),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })

  it('lists dynamic routes', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'r1' }]))
    await expect(h.run('cloudflare_aigateway_routes', { gatewayId: 'gw1' })).resolves.toEqual({
      routes: [{ id: 'r1' }],
    })
  })

  it('renders a route count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.tool('cloudflare_aigateway_routes').output.render({ gatewayId: 'g' }, { routes: [] })).toEqual([
      { type: 'text', text: expect.stringContaining('0 routes') },
    ])
  })

  it.each(['credit-balance', 'usage-history', 'invoice-preview'] as const)('reads the %s billing view', async (view) => {
    const h = makeHarness(aiTools, async () => envelope({ amount: 1 }))
    await expect(h.run('cloudflare_aigateway_cost', { view })).resolves.toEqual({
      view,
      billing: { amount: 1 },
    })
    expect(h.requests[0]!.url).toBe(`https://api.test/v4/accounts/a1/ai-gateway/billing/${view}`)
  })

  it('rejects a billing view outside the supported set', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run('cloudflare_aigateway_cost', { view: 'everything' })).rejects.toThrow()
  })

  it('renders the billing view as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_aigateway_cost').output.render({ view: 'credit-balance' }, { view: 'credit-balance', billing: { a: 1 } }),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })
})

describe('summariseSessionLogs', () => {
  it('reports zeros for an empty session', () => {
    expect(aiTools.summariseSessionLogs([])).toStrictEqual({
      requests: 0,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it('sums cost and tokens across entries', () => {
    expect(
      aiTools.summariseSessionLogs([
        { cost: 0.5, tokens_in: 10, tokens_out: 20, cached: false },
        { cost: 1.5, tokens_in: 5, tokens_out: 1, cached: true },
      ]),
    ).toStrictEqual({ requests: 2, cost: 2, tokensIn: 15, tokensOut: 21, cached: 1 })
  })

  it('treats missing numeric fields as zero', () => {
    expect(aiTools.summariseSessionLogs([{}])).toStrictEqual({
      requests: 1,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it('counts only entries explicitly marked cached', () => {
    expect(aiTools.summariseSessionLogs([{ cached: false }, {}, { cached: true }]).cached).toBe(1)
  })
})

describe('cloudflare_aigateway_session_cost', () => {
  it('summarises the logs for one session', async () => {
    const h = makeHarness(aiTools, async () =>
      envelope([
        { cost: 1, tokens_in: 2, tokens_out: 3, cached: true },
        { cost: 2, tokens_in: 1, tokens_out: 1 },
      ]),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).resolves.toEqual({ requests: 2, cost: 3, tokensIn: 3, tokensOut: 4, cached: 1 })
  })

  it('filters the gateway logs by session id', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' })
    expect(h.requests[0]!.url).toContain('metadata.sessionId=s1')
  })

  it('scans 100 entries by default', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' })
    expect(h.requests[0]!.url).toContain('per_page=100')
  })

  it('honours an explicit scan size', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1', perPage: 7 })
    expect(h.requests[0]!.url).toContain('per_page=7')
  })

  it('renders a one-line session summary', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.tool('cloudflare_aigateway_session_cost').output.render(
        { gatewayId: 'g', sessionId: 's1' },
        { requests: 3, cost: 1.25, tokensIn: 0, tokensOut: 0, cached: 2 },
      ),
    ).toEqual([{ type: 'text', text: 'Session s1: 3 requests, 2 served from cache, cost 1.25.' }])
  })
})

describe('AI Search and Vectorize tools', () => {
  it('searches an instance', async () => {
    const h = makeHarness(aiTools, async () => envelope({ data: [] }))
    await expect(h.run('cloudflare_aisearch_search', { instanceId: 'i1', query: 'q' })).resolves.toEqual({
      results: { data: [] },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"query":"q","max_num_results":10}')
  })

  it('honours an explicit result limit', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_aisearch_search', { instanceId: 'i1', query: 'q', maxResults: 3 })
    await expect(h.requests[0]!.text()).resolves.toBe('{"query":"q","max_num_results":3}')
  })

  it('renders search results as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_aisearch_search').output.render({ instanceId: 'i', query: 'q' }, { results: { a: 1 } }),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })

  it('asks for a grounded answer', async () => {
    const h = makeHarness(aiTools, async () => envelope({ choices: [] }))
    await expect(h.run('cloudflare_aisearch_chat', { instanceId: 'i1', query: 'why' })).resolves.toEqual({
      answer: { choices: [] },
    })
  })

  it('overrides the generating model when given', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_aisearch_chat', { instanceId: 'i1', query: 'why', model: '@cf/m' })
    await expect(h.requests[0]!.text()).resolves.toContain('"model":"@cf/m"')
  })

  it('renders a grounded answer as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_aisearch_chat').output.render({ instanceId: 'i', query: 'q' }, { answer: { a: 1 } }),
    ).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })

  it('triggers a sync job', async () => {
    const h = makeHarness(aiTools, async () => envelope({ id: 'job1' }))
    await expect(h.run('cloudflare_aisearch_sync', { instanceId: 'i1' })).resolves.toEqual({
      job: { id: 'job1' },
    })
    expect(h.requests[0]!.method).toBe('POST')
  })

  it('renders the sync job as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.tool('cloudflare_aisearch_sync').output.render({ instanceId: 'i' }, { job: { id: 'j' } })).toEqual([
      { type: 'text', text: '{\n  "id": "j"\n}' },
    ])
  })

  it('lists vectorize indexes', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: 'idx' }]))
    await expect(h.run('cloudflare_vectorize_index_list', {})).resolves.toEqual({ indexes: [{ name: 'idx' }] })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/vectorize/v2/indexes')
  })

  it('renders an index count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.tool('cloudflare_vectorize_index_list').output.render({}, { indexes: [{}] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 index') },
    ])
  })

  it('queries an index with defaults', async () => {
    const h = makeHarness(aiTools, async () => envelope({ matches: [] }))
    await expect(h.run('cloudflare_vectorize_query', { indexName: 'idx', vector: [0.1] })).resolves.toEqual({
      matches: { matches: [] },
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"vector":[0.1],"topK":5,"returnValues":false,"returnMetadata":"all"}',
    )
  })

  it('honours explicit query options', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_vectorize_query', {
      indexName: 'idx',
      vector: [0.1],
      topK: 2,
      returnValues: true,
      returnMetadata: false,
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"vector":[0.1],"topK":2,"returnValues":true,"returnMetadata":"none"}',
    )
  })

  it('renders matches as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.tool('cloudflare_vectorize_query').output.render({ indexName: 'i', vector: [] }, { matches: [] }),
    ).toEqual([{ type: 'text', text: '[]' }])
  })
})

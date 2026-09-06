import { describe, expect, it } from 'vitest'
import { json } from '../src/tools/_shared/render.ts'
import * as aiTools from '../src/tools/ai.ts'
import { sessionOf, summariseSessionLogs } from '../src/tools/ai.ts'
import { envelope, failure, makeHarness } from './harness.ts'

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

describe('cloudflare_ai_run', () => {
  it('refuses a streaming request, which its single response could not carry', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(
      h.run('cloudflare_ai_run', { model: '@cf/meta/m', input: { prompt: 'hi', stream: true } }),
    ).rejects.toThrow(
      'cloudflare_ai_run returns one complete response; a streamed completion comes from the cloudflare-workers-ai model provider instead',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('names the streaming refusal so a caller can tell it from a provider failure', () => {
    expect(new aiTools.AiRunStreamError()).toMatchObject({ name: 'AiRunStreamError' })
  })

  it('runs a model and returns its output', async () => {
    const h = makeHarness(aiTools, async () => envelope({ response: 'hi' }))
    await expect(
      h.run('cloudflare_ai_run', {
        model: '@cf/meta/llama-3.1-8b-instruct',
        input: { prompt: 'x' },
      }),
    ).resolves.toEqual({
      model: '@cf/meta/llama-3.1-8b-instruct',
      output: { response: 'hi' },
    })
  })

  it('posts to the account-scoped run path with the slug preserved', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', { model: '@cf/meta/m', input: {} })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/run/%40cf/meta/m')
  })

  it('sends the input as the request body', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', {
      model: '@cf/m',
      input: { prompt: 'x' },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"prompt":"x"}')
  })

  it('renders the model output as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_ai_run', { model: 'm', input: {} }, { model: 'm', output: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
  })

  it('surfaces a model error', async () => {
    const h = makeHarness(aiTools, async () => failure(5006, 'model not found', 404))
    await expect(h.run('cloudflare_ai_run', { model: '@cf/nope', input: {} })).rejects.toThrow(
      'model not found',
    )
  })
})

describe('model catalogue tools', () => {
  it('searches the first page of 50 models by default, inferring completeness from a short page', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: '@cf/m' }]))
    await expect(h.run('cloudflare_ai_models_search', {})).resolves.toEqual({
      models: [{ name: '@cf/m' }],
      page: 1,
      perPage: 50,
      total: null,
      complete: true,
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/models/search?page=1&per_page=50')
  })

  it('says more may follow a full page, since the catalogue reports no total', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: '@cf/a' }, { name: '@cf/b' }]))
    await expect(h.run('cloudflare_ai_models_search', { perPage: 2 })).resolves.toMatchObject({
      total: null,
      complete: false,
    })
  })

  it('passes page, search and task filters', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_ai_models_search', {
      search: 'llama',
      task: 'Text Generation',
      page: 2,
      perPage: 5,
    })
    const url = h.requests[0]!.url
    expect(url).toContain('search=llama')
    expect(url).toContain('task=Text+Generation')
    expect(url).toContain('page=2&per_page=5')
  })

  it('renders a model count with its page context', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_ai_models_search',
        {},
        { models: [{}, {}], page: 1, perPage: 2, total: null, complete: false },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('2 models (page 1, more may follow)') }])
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
    expect(h.render('cloudflare_ai_model_schema', { model: 'm' }, { model: 'm', schema: { a: 1 } })).toEqual(
      json({ a: 1 }),
    )
  })
})

describe('gateway tools', () => {
  it('lists the first page of 50 gateways by default', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'gw1' }]))
    await expect(h.run('cloudflare_aigateway_list', {})).resolves.toEqual({
      gateways: [{ id: 'gw1' }],
      page: 1,
      perPage: 50,
      total: null,
      complete: true,
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai-gateway/gateways?page=1&per_page=50')
  })

  it('honours an explicit page of gateways', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_list', { page: 4, perPage: 10 })
    expect(h.requests[0]!.url).toContain('page=4&per_page=10')
  })

  it('renders a gateway count with its page context', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_list',
        {},
        { gateways: [{}], page: 1, perPage: 50, total: null, complete: true },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('1 gateway (page 1, the last)') }])
  })

  it('fetches one gateway', async () => {
    const h = makeHarness(aiTools, async () => envelope({ id: 'gw1' }))
    await expect(h.run('cloudflare_aigateway_get', { gatewayId: 'gw1' })).resolves.toEqual({
      gateway: { id: 'gw1' },
    })
  })

  it('renders a gateway config as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.render('cloudflare_aigateway_get', { gatewayId: 'g' }, { gateway: { id: 'g' } })).toEqual(
      json({ id: 'g' }),
    )
  })

  it('queries logs by page, reporting which page it read', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'l1' }]))
    await expect(h.run('cloudflare_aigateway_logs', { gatewayId: 'gw1' })).resolves.toEqual({
      logs: [{ id: 'l1' }],
      page: 1,
      perPage: 50,
      complete: true,
    })
    // The whole query, so a clause sent when none was asked for is visible.
    expect(new URL(h.requests[0]!.url).search).toBe('?page=1&per_page=50')
  })

  it('serializes filter clauses the way the endpoint expects', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_logs', {
      gatewayId: 'gw1',
      filters: [{ key: 'metadata.value', operator: 'eq', value: 's1' }],
    })
    const url = decodeURIComponent(h.requests[0]!.url)
    expect(url).toContain('filters.key=metadata.value&filters.operator=eq&filters.value=s1')
  })

  it.each([
    'id',
    'created_at',
    'request_type',
    'success',
    'cached',
    'provider',
    'model',
    'model_type',
    'cost',
    'tokens',
    'tokens_in',
    'tokens_out',
    'duration',
    'feedback',
    'event_id',
    'metadata.key',
    'metadata.value',
  ])('accepts the filterable field %s', async (key) => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_logs', {
      gatewayId: 'gw1',
      filters: [{ key, operator: 'eq', value: 'x' }],
    })
    expect(decodeURIComponent(h.requests[0]!.url)).toContain(
      `filters.key=${key}&filters.operator=eq&filters.value=x`,
    )
  })

  it.each(['eq', 'neq', 'contains', 'lt', 'gt'])('accepts the %s comparison', async (operator) => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_logs', {
      gatewayId: 'gw1',
      filters: [{ key: 'model', operator, value: 'x' }],
    })
    expect(decodeURIComponent(h.requests[0]!.url)).toContain(
      `filters.key=model&filters.operator=${operator}&filters.value=x`,
    )
  })

  it.each([
    [
      'an unfilterable field',
      [{ key: 'nope', operator: 'eq', value: 'x' }],
      'invalid arguments: "filters[0].key" must be one of ["id","created_at","request_type","success","cached","provider","model","model_type","cost","tokens","tokens_in","tokens_out","duration","feedback","event_id","metadata.key","metadata.value"]',
    ],
    [
      'an unsupported comparison',
      [{ key: 'model', operator: 'like', value: 'x' }],
      'invalid arguments: "filters[0].operator" must be one of ["eq","neq","contains","lt","gt"]',
    ],
    [
      'a non-string value',
      [{ key: 'model', operator: 'eq', value: { a: 1 } }],
      'invalid arguments: "filters[0].value" must be a string',
    ],
    ['a non-array filters value', { key: 'model' }, 'invalid arguments: "filters" must be an array'],
  ])('rejects %s instead of sending it as text', async (_label, filters, message) => {
    // The old shape was cast to `Record<string, string>`, so a non-string value
    // reached `String(value)` and went on the wire as "[object Object]". An
    // argument-less throw assertion would accept any failure, including a
    // network one; the message pins each rejection to the parameter schema,
    // which carries the filterable fields and comparisons as enums, so the
    // model reads the same list the validator enforces.
    const h = makeHarness(aiTools, async () => envelope([]))
    await expect(h.run('cloudflare_aigateway_logs', { gatewayId: 'gw1', filters })).rejects.toThrow(message)
    expect(h.requests).toHaveLength(0)
  })

  it('renders a log count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_logs',
        { gatewayId: 'g' },
        { logs: [{}], page: 1, perPage: 50, complete: true },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('1 log entry') }])
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
      h.render(
        'cloudflare_aigateway_log_body',
        { gatewayId: 'g', logId: 'l', part: 'request' },
        { body: { a: 1 } },
      ),
    ).toEqual(json({ a: 1 }))
  })

  it('lists dynamic routes', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'r1' }]))
    await expect(h.run('cloudflare_aigateway_routes', { gatewayId: 'gw1' })).resolves.toEqual({
      routes: [{ id: 'r1' }],
    })
  })

  it('renders a route count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.render('cloudflare_aigateway_routes', { gatewayId: 'g' }, { routes: [] })).toEqual([
      { type: 'text', text: expect.stringContaining('0 routes') },
    ])
  })

  it.each(['credit-balance', 'usage-history', 'invoice-preview'] as const)(
    'reads the %s billing view',
    async (view) => {
      const h = makeHarness(aiTools, async () => envelope({ amount: 1 }))
      await expect(h.run('cloudflare_aigateway_cost', { view })).resolves.toEqual({
        view,
        billing: { amount: 1 },
      })
      expect(h.requests[0]!.url).toBe(`https://api.test/v4/accounts/a1/ai-gateway/billing/${view}`)
    },
  )

  it('rejects a billing view outside the supported set', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run('cloudflare_aigateway_cost', { view: 'everything' })).rejects.toThrow(
      'invalid arguments: "view" must be one of ["credit-balance","usage-history","invoice-preview"]',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders the billing view as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render(
        'cloudflare_aigateway_cost',
        { view: 'credit-balance' },
        { view: 'credit-balance', billing: { a: 1 } },
      ),
    ).toEqual(json({ a: 1 }))
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
    ).toStrictEqual({
      requests: 2,
      cost: 2,
      tokensIn: 15,
      tokensOut: 21,
      cached: 1,
    })
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

/** A log row carrying the metadata the gateway records. */
function row(sessionId: string, rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { metadata: JSON.stringify({ sessionId }), ...rest }
}

describe('cloudflare_aigateway_session_cost', () => {
  it('summarises the logs for one session', async () => {
    const h = makeHarness(aiTools, async () =>
      envelope([
        row('s1', { cost: 1, tokens_in: 2, tokens_out: 3, cached: true }),
        row('s1', { cost: 2, tokens_in: 1, tokens_out: 1 }),
      ]),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).resolves.toEqual({
      requests: 2,
      cost: 3,
      tokensIn: 3,
      tokensOut: 4,
      cached: 1,
      scanned: 2,
      pages: 1,
      truncated: false,
    })
  })

  it('counts only rows whose metadata really carries this session', async () => {
    // The load-bearing assertion. Cloudflare does not document how positional
    // filter repeats are paired, so a filter the server ignores would return
    // every session's logs — and one session would be billed another's cost.
    const h = makeHarness(aiTools, async () =>
      envelope([row('s1', { cost: 1 }), row('other-session', { cost: 99 }), { cost: 50 }]),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).resolves.toMatchObject({ requests: 1, cost: 1, scanned: 3 })
  })

  it('rejects a cost the API returned as a string rather than concatenating it', async () => {
    // `cost += "0.004"` turns the running total into a string.
    const h = makeHarness(aiTools, async () => envelope([row('s1', { cost: '0.004' })]))
    await expect(
      h.run('cloudflare_aigateway_session_cost', { gatewayId: 'gw1', sessionId: 's1' }),
    ).rejects.toThrow(
      'gateway log field cost must be a number, got string ("0.004"). Summing it would produce a total that is silently wrong.',
    )
  })

  it('reports an incomplete page when the page came back full', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'a' }]))
    await expect(h.run('cloudflare_aigateway_logs', { gatewayId: 'gw1', perPage: 1 })).resolves.toMatchObject(
      {
        complete: false,
      },
    )
  })

  it('filters the gateway logs with the two-clause metadata form', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
    })
    const url = decodeURIComponent(h.requests[0]!.url)
    expect(url).toContain('filters.key=metadata.key&filters.operator=eq&filters.value=sessionId')
    expect(url).toContain('filters.key=metadata.value&filters.operator=eq&filters.value=s1')
  })

  it('scans at the endpoint maximum by default', async () => {
    // The old default was 100, above the documented maximum of 50, so the
    // request was invalid before any filtering question arose.
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
    })
    expect(h.requests[0]!.url).toContain('per_page=50')
  })

  it('refuses a scan size the endpoint will not serve', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await expect(
      h.run('cloudflare_aigateway_session_cost', {
        gatewayId: 'gw1',
        sessionId: 's1',
        perPage: 100,
      }),
    ).rejects.toThrow(/perPage must be between/)
    expect(h.requests).toHaveLength(0)
  })

  it('says so in the rendered summary when the scan was cut short', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_session_cost',
        { gatewayId: 'g', sessionId: 's1' },
        { requests: 1, cost: 1, tokensIn: 0, tokensOut: 0, cached: 0, scanned: 1, pages: 1, truncated: true },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('partial') }])
  })

  it('reports a scan the page ceiling cut short', async () => {
    const h = makeHarness(aiTools, async () =>
      envelope([{ metadata: JSON.stringify({ sessionId: 's1' }), cost: 1 }], {
        page: 1,
        per_page: 1,
        total_count: 999,
      }),
    )
    await expect(
      h.run('cloudflare_aigateway_session_cost', {
        gatewayId: 'gw1',
        sessionId: 's1',
      }),
    ).resolves.toMatchObject({ truncated: true })
  })

  it('honours an explicit scan size', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_aigateway_session_cost', {
      gatewayId: 'gw1',
      sessionId: 's1',
      perPage: 7,
    })
    expect(h.requests[0]!.url).toContain('per_page=7')
  })

  it('renders a one-line session summary', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_aigateway_session_cost',
        { gatewayId: 'g', sessionId: 's1' },
        {
          requests: 3,
          cost: 1.25,
          tokensIn: 0,
          tokensOut: 0,
          cached: 2,
          scanned: 3,
          pages: 1,
          truncated: false,
        },
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
    await h.run('cloudflare_aisearch_search', {
      instanceId: 'i1',
      query: 'q',
      maxResults: 3,
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"query":"q","max_num_results":3}')
  })

  it('renders search results as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_aisearch_search', { instanceId: 'i', query: 'q' }, { results: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
  })

  it('asks for a grounded answer', async () => {
    const h = makeHarness(aiTools, async () => envelope({ choices: [] }))
    await expect(h.run('cloudflare_aisearch_chat', { instanceId: 'i1', query: 'why' })).resolves.toEqual({
      answer: { choices: [] },
    })
  })

  it('overrides the generating model when given', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_aisearch_chat', {
      instanceId: 'i1',
      query: 'why',
      model: '@cf/m',
    })
    await expect(h.requests[0]!.text()).resolves.toContain('"model":"@cf/m"')
  })

  it('renders a grounded answer as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_aisearch_chat', { instanceId: 'i', query: 'q' }, { answer: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
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
    expect(h.render('cloudflare_aisearch_sync', { instanceId: 'i' }, { job: { id: 'j' } })).toEqual(
      json({ id: 'j' }),
    )
  })

  it('lists vectorize indexes', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: 'idx' }]))
    await expect(h.run('cloudflare_vectorize_index_list', {})).resolves.toEqual({
      indexes: [{ name: 'idx' }],
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/vectorize/v2/indexes')
  })

  it('renders an index count', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(h.render('cloudflare_vectorize_index_list', {}, { indexes: [{}] })).toEqual([
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
      returnMetadata: 'indexed',
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"vector":[0.1],"topK":2,"returnValues":true,"returnMetadata":"indexed"}',
    )
  })

  it('writes vectors as NDJSON and reports what it sent beside the mutation', async () => {
    const h = makeHarness(aiTools, async () => envelope({ mutationId: 'm1' }))
    await expect(
      h.run('cloudflare_vectorize_upsert', {
        indexName: 'idx',
        vectors: [
          { id: 'a', values: [0.1] },
          { id: 'b', values: [0.2], metadata: { lang: 'en' } },
        ],
      }),
    ).resolves.toEqual({ written: 2, mutation: { mutationId: 'm1' } })
    expect(h.requests[0]!.url).toBe(
      'https://api.test/v4/accounts/a1/vectorize/v2/indexes/idx/upsert?unparsable-behavior=error',
    )
    expect(h.requests[0]!.headers.get('content-type')).toBe('application/x-ndjson')
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"id":"a","values":[0.1]}\n{"id":"b","values":[0.2],"metadata":{"lang":"en"}}',
    )
  })

  it('sends an insert to the insert endpoint, which refuses an id already stored', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_vectorize_upsert', {
      indexName: 'idx',
      vectors: [{ id: 'a', values: [0.1] }],
      mode: 'insert',
      unparsableBehavior: 'discard',
    })
    expect(h.requests[0]!.url).toBe(
      'https://api.test/v4/accounts/a1/vectorize/v2/indexes/idx/insert?unparsable-behavior=discard',
    )
  })

  it('refuses a write naming no vectors rather than issuing one that does nothing', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run('cloudflare_vectorize_upsert', { indexName: 'idx', vectors: [] })).rejects.toThrow(
      'vectors must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders the count sent and the mutation record', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render(
        'cloudflare_vectorize_upsert',
        { indexName: 'idx', vectors: [] },
        { written: 2, mutation: { mutationId: 'm1' } },
      ),
    ).toEqual([
      { type: 'text', text: 'Sent 2 vectors.' },
      { type: 'text', text: '{\n  "mutationId": "m1"\n}' },
    ])
  })

  it('deletes vectors by id and reports how many it asked for', async () => {
    const h = makeHarness(aiTools, async () => envelope({ mutationId: 'm2' }))
    await expect(
      h.run('cloudflare_vectorize_delete', { indexName: 'idx', ids: ['a', 'b'] }),
    ).resolves.toEqual({ requested: 2, mutation: { mutationId: 'm2' } })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/vectorize/v2/indexes/idx/delete_by_ids')
    await expect(h.requests[0]!.text()).resolves.toBe('{"ids":["a","b"]}')
  })

  it('refuses a deletion naming no ids', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run('cloudflare_vectorize_delete', { indexName: 'idx', ids: [] })).rejects.toThrow(
      'ids must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders the count asked for and the mutation record', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render(
        'cloudflare_vectorize_delete',
        { indexName: 'idx', ids: [] },
        { requested: 1, mutation: null },
      ),
    ).toEqual([
      { type: 'text', text: 'Asked to delete 1 vector.' },
      { type: 'text', text: 'null' },
    ])
  })

  it('reads vectors back by id', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'a', values: [0.1] }]))
    await expect(h.run('cloudflare_vectorize_get', { indexName: 'idx', ids: ['a'] })).resolves.toEqual({
      vectors: [{ id: 'a', values: [0.1] }],
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/vectorize/v2/indexes/idx/get_by_ids')
    await expect(h.requests[0]!.text()).resolves.toBe('{"ids":["a"]}')
  })

  it('refuses a read naming no ids', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run('cloudflare_vectorize_get', { indexName: 'idx', ids: [] })).rejects.toThrow(
      'ids must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders the vectors it read as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_vectorize_get', { indexName: 'idx', ids: [] }, { vectors: [{ id: 'a' }] }),
    ).toEqual(json([{ id: 'a' }]))
  })

  it('renders matches as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.render('cloudflare_vectorize_query', { indexName: 'i', vector: [] }, { matches: [] })).toEqual([
      { type: 'text', text: '[]' },
    ])
  })
})

describe('sessionOf', () => {
  it('reads the session id the gateway recorded', () => {
    expect(sessionOf({ metadata: JSON.stringify({ sessionId: 's1' }) })).toBe('s1')
  })

  it.each([
    ['metadata is absent', {}],
    ['metadata is not a string', { metadata: { sessionId: 's1' } }],
    ['metadata is not valid JSON', { metadata: '{oops' }],
    ['metadata is not an object', { metadata: '"a string"' }],
    ['metadata is null', { metadata: 'null' }],
    ['the session id is not a string', { metadata: JSON.stringify({ sessionId: 7 }) }],
    ['the session id is absent', { metadata: JSON.stringify({ purpose: 'compaction' }) }],
  ])('returns nothing when %s', (_label, entry) => {
    expect(sessionOf(entry)).toBeUndefined()
  })
})

describe('summariseSessionLogs', () => {
  it('adds up the fields a gateway log carries', () => {
    expect(
      summariseSessionLogs([
        { cost: 1, tokens_in: 2, tokens_out: 3, cached: true },
        { cost: 2, tokens_in: 1, tokens_out: 1 },
      ]),
    ).toEqual({ requests: 2, cost: 3, tokensIn: 3, tokensOut: 4, cached: 1 })
  })

  it('treats a missing field as zero, since providers omit some', () => {
    expect(summariseSessionLogs([{}])).toEqual({
      requests: 1,
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
      cached: 0,
    })
  })

  it.each([
    ['not a number', 'cost', '0.004'],
    ['NaN', 'cost', Number.NaN],
    ['infinite', 'cost', Number.POSITIVE_INFINITY],
    ['NaN tokens in', 'tokens_in', Number.NaN],
    ['NaN tokens out', 'tokens_out', Number.NaN],
  ])('refuses a %s value rather than producing a silently wrong total', (_label, field, value) => {
    // Tested here rather than through the tool: a JSON round-trip turns NaN and
    // Infinity into null, so the transport would hide these cases entirely.
    expect(() => summariseSessionLogs([{ [field]: value }])).toThrow(
      expect.objectContaining({ name: 'GatewayLogShapeError' }),
    )
  })
})

describe('what the usage chip is given', () => {
  it('publishes the five figures the chip renders, which the summary line carries three of', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    const meta = h.tool('cloudflare_aigateway_session_cost').output.presentationMeta?.(
      { gatewayId: 'gw1', sessionId: 's1' },
      {
        requests: 4,
        cost: 0.0125,
        tokensIn: 120,
        tokensOut: 40,
        cached: 1,
        scanned: 9,
        pages: 1,
        truncated: false,
      },
    )
    expect(meta).toEqual({ requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 })
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

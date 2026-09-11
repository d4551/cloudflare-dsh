/**
 * AI Gateway administration tools: gateways, logs and their bodies, routes,
 * and billing views.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../../src/tools/_shared/render.ts'
import * as aiTools from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

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

  it('reports an incomplete page when the page came back full', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'a' }]))
    await expect(h.run('cloudflare_aigateway_logs', { gatewayId: 'gw1', perPage: 1 })).resolves.toMatchObject(
      {
        complete: false,
      },
    )
  })
})

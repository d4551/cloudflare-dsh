import { describe, expect, it } from 'vitest'
import {
  GATEWAY_LOG_MAX_PAGE_SIZE,
  GATEWAY_LOG_MIN_PAGE_SIZE,
  GatewayLogPageSizeError,
  aiModelSchemaSpec,
  aiModelsSearchSpec,
  aiRunSpec,
  aiSearchChatSpec,
  aiSearchSearchSpec,
  aiSearchSyncSpec,
  gatewayBillingSpec,
  gatewayGetSpec,
  gatewayListSpec,
  gatewayLogBodySpec,
  gatewayLogsSpec,
  gatewayRouteListSpec,
  gatewayUrlSpec,
  sessionLogFilters,
  vectorizeIndexListSpec,
  vectorizeQuerySpec,
} from '../src/specs/ai.ts'

describe('Workers AI specs', () => {
  it('runs a model, keeping slug slashes as path separators', () => {
    expect(aiRunSpec('@cf/meta/llama-3.1-8b-instruct', { prompt: 'hi' })).toStrictEqual({
      method: 'POST',
      path: '/ai/run/%40cf/meta/llama-3.1-8b-instruct',
      body: { prompt: 'hi' },
    })
  })

  it('encodes each slug segment separately', () => {
    expect(aiRunSpec('@cf/a b/c', {}).path).toBe('/ai/run/%40cf/a%20b/c')
  })

  it('searches models with only a page size by default', () => {
    expect(aiModelsSearchSpec(undefined, undefined, 50)).toStrictEqual({
      method: 'GET',
      path: '/ai/models/search',
      query: { per_page: 50 },
    })
  })

  it('adds search and task filters when given', () => {
    expect(aiModelsSearchSpec('llama', 'Text Generation', 10).query).toStrictEqual({
      per_page: 10,
      search: 'llama',
      task: 'Text Generation',
    })
  })

  it('adds only the search filter when the task is omitted', () => {
    expect(aiModelsSearchSpec('llama', undefined, 10).query).toStrictEqual({
      per_page: 10,
      search: 'llama',
    })
  })

  it('adds only the task filter when the search is omitted', () => {
    expect(aiModelsSearchSpec(undefined, 'Summarization', 10).query).toStrictEqual({
      per_page: 10,
      task: 'Summarization',
    })
  })

  it('fetches a model schema by query parameter', () => {
    expect(aiModelSchemaSpec('@cf/m')).toStrictEqual({
      method: 'GET',
      path: '/ai/models/schema',
      query: { model: '@cf/m' },
    })
  })
})

describe('AI Gateway specs', () => {
  it('uses the hyphenated ai-gateway prefix, not /ai/gateways', () => {
    expect(gatewayListSpec(50).path).toBe('/ai-gateway/gateways')
  })

  it('lists gateways with a page size', () => {
    expect(gatewayListSpec(25)).toStrictEqual({
      method: 'GET',
      path: '/ai-gateway/gateways',
      query: { per_page: 25 },
    })
  })

  it('fetches one gateway', () => {
    expect(gatewayGetSpec('gw1')).toStrictEqual({
      method: 'GET',
      path: '/ai-gateway/gateways/gw1',
    })
  })

  it('encodes the gateway id', () => {
    expect(gatewayGetSpec('gw/1').path).toBe('/ai-gateway/gateways/gw%2F1')
  })

  it('resolves the per-provider base URL rather than hardcoding one', () => {
    expect(gatewayUrlSpec('gw1', 'workers-ai')).toStrictEqual({
      method: 'GET',
      path: '/ai-gateway/gateways/gw1/url/workers-ai',
    })
  })

  it('queries logs by page number, which is how the endpoint paginates', () => {
    expect(gatewayLogsSpec('gw1', 2, 50, [])).toStrictEqual({
      method: 'GET',
      path: '/ai-gateway/gateways/gw1/logs',
      query: { page: 2, per_page: 50 },
      orderedQuery: [],
    })
  })

  it.each([
    ['below the minimum', GATEWAY_LOG_MIN_PAGE_SIZE - 1],
    ['above the maximum', GATEWAY_LOG_MAX_PAGE_SIZE + 1],
  ])('refuses a page size %s rather than letting the server reject it', (_label, perPage) => {
    expect(() => gatewayLogsSpec('gw1', 1, perPage, [])).toThrow(GatewayLogPageSizeError)
  })

  it.each([GATEWAY_LOG_MIN_PAGE_SIZE, GATEWAY_LOG_MAX_PAGE_SIZE])(
    'accepts the boundary size %i',
    (perPage) => {
      expect(gatewayLogsSpec('gw1', 1, perPage, []).query).toEqual({
        page: 1,
        per_page: perPage,
      })
    },
  )

  it('names the bounds so a caller can correct the value', () => {
    expect(() => gatewayLogsSpec('gw1', 1, 100, [])).toThrow('perPage must be between 1 and 50, got 100')
  })

  it('names the page-size error so a log line identifies it', () => {
    expect(() => gatewayLogsSpec('gw1', 1, 100, [])).toThrow(
      expect.objectContaining({ name: 'GatewayLogPageSizeError' }),
    )
  })

  it('serializes filter clauses as dotted positional repeats', () => {
    // This is the form Cloudflare's own SDKs emit
    // (`qs.stringify(query, { allowDots: true, arrayFormat: 'repeat' })`), so
    // the triple repeats per clause and the order carries the pairing.
    expect(gatewayLogsSpec('gw1', 1, 10, sessionLogFilters('s1', 'sessionId')).orderedQuery).toStrictEqual([
      ['filters.key', 'metadata.key'],
      ['filters.operator', 'eq'],
      ['filters.value', 'sessionId'],
      ['filters.key', 'metadata.value'],
      ['filters.operator', 'eq'],
      ['filters.value', 's1'],
    ])
  })

  it('selects a session with two clauses, since there is no metadata.sessionId field', () => {
    expect(sessionLogFilters('abc', 'sessionId')).toStrictEqual([
      { key: 'metadata.key', operator: 'eq', value: 'sessionId' },
      { key: 'metadata.value', operator: 'eq', value: 'abc' },
    ])
  })

  it.each(['request', 'response'] as const)('fetches a stored %s body', (part) => {
    expect(gatewayLogBodySpec('gw1', 'log1', part)).toStrictEqual({
      method: 'GET',
      path: `/ai-gateway/gateways/gw1/logs/log1/${part}`,
    })
  })

  it('lists dynamic routes', () => {
    expect(gatewayRouteListSpec('gw1')).toStrictEqual({
      method: 'GET',
      path: '/ai-gateway/gateways/gw1/routes',
    })
  })

  it.each(['credit-balance', 'usage-history', 'invoice-preview'] as const)(
    'reads the %s billing view',
    (view) => {
      expect(gatewayBillingSpec(view)).toStrictEqual({
        method: 'GET',
        path: `/ai-gateway/billing/${view}`,
      })
    },
  )
})

describe('AI Search specs', () => {
  it('searches an instance', () => {
    expect(aiSearchSearchSpec('i1', 'what', 10)).toStrictEqual({
      method: 'POST',
      path: '/ai-search/instances/i1/search',
      body: { query: 'what', max_num_results: 10 },
    })
  })

  it('asks for a grounded answer', () => {
    expect(aiSearchChatSpec('i1', 'why', undefined)).toStrictEqual({
      method: 'POST',
      path: '/ai-search/instances/i1/chat/completions',
      body: { messages: [{ role: 'user', content: 'why' }] },
    })
  })

  it('overrides the generating model when one is given', () => {
    expect(aiSearchChatSpec('i1', 'why', '@cf/m').body).toStrictEqual({
      messages: [{ role: 'user', content: 'why' }],
      model: '@cf/m',
    })
  })

  it('triggers a sync job', () => {
    expect(aiSearchSyncSpec('i1')).toStrictEqual({
      method: 'POST',
      path: '/ai-search/instances/i1/jobs',
    })
  })

  it('encodes the instance id', () => {
    expect(aiSearchSyncSpec('i/1').path).toBe('/ai-search/instances/i%2F1/jobs')
  })
})

describe('Vectorize specs', () => {
  it('lists indexes under the v2 path', () => {
    expect(vectorizeIndexListSpec()).toStrictEqual({
      method: 'GET',
      path: '/vectorize/v2/indexes',
    })
  })

  it('queries an index', () => {
    expect(vectorizeQuerySpec('idx', [0.1, 0.2], 5, false, true)).toStrictEqual({
      method: 'POST',
      path: '/vectorize/v2/indexes/idx/query',
      body: {
        vector: [0.1, 0.2],
        topK: 5,
        returnValues: false,
        returnMetadata: 'all',
      },
    })
  })

  it('maps returnMetadata false to none', () => {
    expect(vectorizeQuerySpec('idx', [0], 1, true, false).body).toStrictEqual({
      vector: [0],
      topK: 1,
      returnValues: true,
      returnMetadata: 'none',
    })
  })

  it('encodes the index name', () => {
    expect(vectorizeQuerySpec('a/b', [0], 1, false, false).path).toBe('/vectorize/v2/indexes/a%2Fb/query')
  })
})

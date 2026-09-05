import { describe, expect, it } from 'vitest'
import {
  MAX_METADATA_ENTRIES,
  TooMuchMetadataError,
  buildGatewayHeaders,
  buildGatewayMetadata,
} from '../src/ai/headers.ts'

describe('buildGatewayMetadata', () => {
  it('is empty when nothing is known about the request', () => {
    expect(buildGatewayMetadata({}, undefined)).toStrictEqual({})
  })

  it('carries the session id, which is what makes gateway logs filterable', () => {
    expect(buildGatewayMetadata({ sessionId: 's1' }, undefined)).toStrictEqual({
      sessionId: 's1',
    })
  })

  it('carries the purpose so housekeeping calls are attributable separately', () => {
    expect(buildGatewayMetadata({ purpose: 'compaction' }, undefined)).toStrictEqual({
      purpose: 'compaction',
    })
  })

  it('carries both when both are known', () => {
    expect(buildGatewayMetadata({ sessionId: 's1', purpose: 'session-title' }, undefined)).toStrictEqual({
      sessionId: 's1',
      purpose: 'session-title',
    })
  })

  it('merges configured tags', () => {
    expect(buildGatewayMetadata({ sessionId: 's1' }, { env: 'dev' })).toStrictEqual({
      env: 'dev',
      sessionId: 's1',
    })
  })

  it('lets request identity win over a tag of the same name', () => {
    expect(buildGatewayMetadata({ sessionId: 'real' }, { sessionId: 'spoofed' })).toStrictEqual({
      sessionId: 'real',
    })
  })

  it('emits tags alone when the request has no identity', () => {
    expect(buildGatewayMetadata({}, { env: 'ci' })).toStrictEqual({
      env: 'ci',
    })
  })
})

describe('buildGatewayHeaders', () => {
  it('emits nothing when there is nothing to say', () => {
    expect(buildGatewayHeaders({}, {})).toStrictEqual({})
  })

  it('serializes metadata as JSON', () => {
    expect(buildGatewayHeaders({ sessionId: 's1' }, {})).toStrictEqual({
      'cf-aig-metadata': '{"sessionId":"s1"}',
    })
  })

  it('omits the metadata header entirely when metadata is empty', () => {
    expect(buildGatewayHeaders({}, { tags: {} })['cf-aig-metadata']).toBeUndefined()
  })

  it('sets a cache ttl when configured', () => {
    expect(buildGatewayHeaders({}, { cacheTtlSeconds: 3600 })['cf-aig-cache-ttl']).toBe('3600')
  })

  it('treats a zero cache ttl as no opinion, leaving gateway defaults alone', () => {
    // Sending `cf-aig-cache-ttl: 0` would override the gateway's own cache
    // configuration on every request, which is the opposite of not asking.
    expect(buildGatewayHeaders({}, { cacheTtlSeconds: 0 })['cf-aig-cache-ttl']).toBeUndefined()
  })

  it('sends a positive cache ttl', () => {
    expect(buildGatewayHeaders({}, { cacheTtlSeconds: 60 })['cf-aig-cache-ttl']).toBe('60')
  })

  it('sends no cache ttl at all when none is configured', () => {
    // Without the presence check the header would be sent as the string
    // "undefined", which the gateway would have to interpret.
    expect(buildGatewayHeaders({}, {})['cf-aig-cache-ttl']).toBeUndefined()
  })

  it('skips the cache only when explicitly asked', () => {
    expect(buildGatewayHeaders({}, { skipCache: true })['cf-aig-skip-cache']).toBe('true')
    expect(buildGatewayHeaders({}, { skipCache: false })['cf-aig-skip-cache']).toBeUndefined()
    expect(buildGatewayHeaders({}, {})['cf-aig-skip-cache']).toBeUndefined()
  })

  it('sets a custom cost in the documented per-token object form', () => {
    // Cloudflare documents this header's value as
    // `{"per_token_in": …, "per_token_out": …}`, not a scalar.
    expect(
      buildGatewayHeaders({}, { customCost: { perTokenIn: 0.25, perTokenOut: 0.5 } })['cf-aig-custom-cost'],
    ).toBe('{"per_token_in":0.25,"per_token_out":0.5}')
  })

  it('sets a zero custom cost rather than treating it as absent', () => {
    expect(
      buildGatewayHeaders({}, { customCost: { perTokenIn: 0, perTokenOut: 0 } })['cf-aig-custom-cost'],
    ).toBe('{"per_token_in":0,"per_token_out":0}')
  })

  it('routes to the configured gateway, which Workers AI models require', () => {
    expect(buildGatewayHeaders({}, { gatewayId: 'gw-1' })['cf-aig-gateway-id']).toBe('gw-1')
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('omits the gateway id when %s', (_label, gatewayId) => {
    expect(buildGatewayHeaders({}, { gatewayId })['cf-aig-gateway-id']).toBeUndefined()
  })

  it('sets a custom cache key when configured', () => {
    expect(buildGatewayHeaders({}, { cacheKey: 'k1' })['cf-aig-cache-key']).toBe('k1')
  })

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('omits the cache key when %s', (_label, cacheKey) => {
    expect(buildGatewayHeaders({}, { cacheKey })['cf-aig-cache-key']).toBeUndefined()
  })

  it('sets a gateway-side request timeout when configured', () => {
    expect(buildGatewayHeaders({}, { requestTimeoutMs: 5000 })['cf-aig-request-timeout']).toBe('5000')
  })

  it.each([
    ['unset', undefined],
    ['zero', 0],
  ])('omits the gateway timeout when %s, leaving gateway defaults alone', (_label, requestTimeoutMs) => {
    expect(buildGatewayHeaders({}, { requestTimeoutMs })['cf-aig-request-timeout']).toBeUndefined()
  })

  it.each(['cf-aig-max-attempts', 'cf-aig-retry-delay', 'cf-aig-backoff'])(
    'never sends %s, which would make the gateway retry behind the harness',
    (header) => {
      // One adapter call must be one provider attempt. A gateway-side retry is
      // billed and logged as a separate request the harness never asked for.
      const all = buildGatewayHeaders(
        { sessionId: 's1' },
        {
          cacheTtlSeconds: 60,
          skipCache: true,
          collectLog: true,
          gatewayId: 'gw',
          requestTimeoutMs: 1000,
        },
      )
      expect(all[header]).toBeUndefined()
    },
  )

  it('sets log collection in both directions when configured', () => {
    expect(buildGatewayHeaders({}, { collectLog: true })['cf-aig-collect-log']).toBe('true')
    expect(buildGatewayHeaders({}, { collectLog: false })['cf-aig-collect-log']).toBe('false')
  })

  it('omits log collection when unset', () => {
    expect(buildGatewayHeaders({}, {})['cf-aig-collect-log']).toBeUndefined()
  })

  it('emits every header together', () => {
    expect(
      buildGatewayHeaders(
        { sessionId: 's1', purpose: 'compaction' },
        {
          cacheTtlSeconds: 60,
          skipCache: true,
          customCost: { perTokenIn: 1, perTokenOut: 2 },
          collectLog: false,
          tags: { env: 'ci' },
        },
      ),
    ).toStrictEqual({
      'cf-aig-metadata': '{"env":"ci","sessionId":"s1","purpose":"compaction"}',
      'cf-aig-cache-ttl': '60',
      'cf-aig-skip-cache': 'true',
      'cf-aig-custom-cost': '{"per_token_in":1,"per_token_out":2}',
      'cf-aig-collect-log': 'false',
    })
  })
})

describe('metadata entry limit', () => {
  it('refuses more metadata than the gateway will keep', () => {
    // The gateway keeps 5 entries and drops the rest **silently**. If the
    // session id were the entry dropped, cost attribution would break with no
    // error anywhere, so this fails loudly instead.
    expect(() =>
      buildGatewayMetadata({ sessionId: 's1', purpose: 'compaction' }, { a: '1', b: '2', c: '3', d: '4' }),
    ).toThrow(TooMuchMetadataError)
  })

  it('names the metadata-cap error so a log line identifies it', () => {
    expect(() =>
      buildGatewayMetadata({ sessionId: 's1', purpose: 'compaction' }, { a: '1', b: '2', c: '3', d: '4' }),
    ).toThrow(expect.objectContaining({ name: 'TooMuchMetadataError' }))
  })

  it('allows exactly the documented maximum', () => {
    expect(
      Object.keys(
        buildGatewayMetadata({ sessionId: 's1', purpose: 'compaction' }, { a: '1', b: '2', c: '3' }),
      ),
    ).toHaveLength(MAX_METADATA_ENTRIES)
  })

  it('names the limit, the count, and what to do about it', () => {
    expect(() =>
      buildGatewayMetadata({ sessionId: 's1' }, { a: '1', b: '2', c: '3', d: '4', e: '5' }),
    ).toThrow(
      'cf-aig-metadata accepts at most 5 entries and 6 were supplied. The gateway drops the excess silently, which would break session cost attribution. Reduce `tags` on the cloudflare-llm plugin.',
    )
  })
})

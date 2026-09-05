import { describe, expect, it } from 'vitest'
import { buildGatewayHeaders, buildGatewayMetadata } from '../src/ai/headers.ts'

describe('buildGatewayMetadata', () => {
  it('is empty when nothing is known about the request', () => {
    expect(buildGatewayMetadata({}, undefined)).toStrictEqual({})
  })

  it('carries the session id, which is what makes gateway logs filterable', () => {
    expect(buildGatewayMetadata({ sessionId: 's1' }, undefined)).toStrictEqual({ sessionId: 's1' })
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
    expect(buildGatewayMetadata({}, { env: 'ci' })).toStrictEqual({ env: 'ci' })
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

  it('omits the cache ttl when unset, leaving gateway defaults alone', () => {
    expect(buildGatewayHeaders({}, {})['cf-aig-cache-ttl']).toBeUndefined()
  })

  it('skips the cache only when explicitly asked', () => {
    expect(buildGatewayHeaders({}, { skipCache: true })['cf-aig-skip-cache']).toBe('true')
    expect(buildGatewayHeaders({}, { skipCache: false })['cf-aig-skip-cache']).toBeUndefined()
    expect(buildGatewayHeaders({}, {})['cf-aig-skip-cache']).toBeUndefined()
  })

  it('sets a custom cost when configured', () => {
    expect(buildGatewayHeaders({}, { customCost: 0.25 })['cf-aig-custom-cost']).toBe('0.25')
  })

  it('sets a zero custom cost rather than treating it as absent', () => {
    expect(buildGatewayHeaders({}, { customCost: 0 })['cf-aig-custom-cost']).toBe('0')
  })

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
        { cacheTtlSeconds: 60, skipCache: true, customCost: 1, collectLog: false, tags: { env: 'ci' } },
      ),
    ).toStrictEqual({
      'cf-aig-metadata': '{"env":"ci","sessionId":"s1","purpose":"compaction"}',
      'cf-aig-cache-ttl': '60',
      'cf-aig-skip-cache': 'true',
      'cf-aig-custom-cost': '1',
      'cf-aig-collect-log': 'false',
    })
  })
})

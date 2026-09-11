/**
 * The data plugin's composition surface: identity, the registered tool set,
 * and the configuration contract every tool reads its defaults from.
 */
import { describe, expect, it } from 'vitest'
import * as dataTools from '../src/tools/data/index.ts'
import { envelope, makeHarness } from './harness.ts'

const EXPECTED_TOOLS = [
  'cloudflare_kv_namespace_list',
  'cloudflare_kv_list_keys',
  'cloudflare_kv_get',
  'cloudflare_kv_put',
  'cloudflare_kv_delete',
  'cloudflare_d1_list',
  'cloudflare_d1_query',
  'cloudflare_queue_list',
  'cloudflare_queue_send',
  'cloudflare_queue_pull',
  'cloudflare_queue_ack',
  'cloudflare_r2_bucket_list',
  'cloudflare_r2_bucket_create',
]

describe('plugin shape', () => {
  it('declares its name', () => {
    expect(dataTools.name).toBe('cloudflare-tools-data')
  })

  it('injects the tools registry and the cloudflare seam', () => {
    expect(dataTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers exactly the expected tools', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.names().toSorted()).toEqual([...EXPECTED_TOOLS].toSorted())
  })

  it('gives every tool a description and an output schema', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    for (const name of EXPECTED_TOOLS) {
      const tool = h.tool(name)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.output.schema).toMatchObject({ type: 'object' })
    }
  })

  it.each([
    ['cloudflare_kv_get', { namespaceId: 'n', key: 'k' }],
    ['cloudflare_kv_list_keys', { namespaceId: 'n' }],
    ['cloudflare_kv_namespace_list', {}],
    ['cloudflare_d1_list', {}],
    ['cloudflare_queue_list', {}],
    ['cloudflare_r2_bucket_list', {}],
  ])('marks %s as concurrency safe', (name, args) => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.tool(name).isConcurrencySafe?.(args)).toBe(true)
  })

  it('leaves write tools exclusive, so they never join a parallel group', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.tool('cloudflare_kv_put').isConcurrencySafe).toBeUndefined()
    expect(h.tool('cloudflare_kv_delete').isConcurrencySafe).toBeUndefined()
    expect(h.tool('cloudflare_d1_query').isConcurrencySafe).toBeUndefined()
    expect(h.tool('cloudflare_queue_send').isConcurrencySafe).toBeUndefined()
  })

  it('refuses concurrency for arguments that do not validate', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.tool('cloudflare_kv_get').isConcurrencySafe?.({})).toBe(false)
  })
})

describe('DataToolsConfig', () => {
  it('defaults every tunable the tools used to hard-code', () => {
    expect(dataTools.Config({})).toStrictEqual({
      pageSize: 50,
      keyListLimit: 1000,
      renderLimit: 4000,
      queueBatchSize: 10,
      queueVisibilityTimeoutMs: 30_000,
    })
  })

  it('rejects a zero page size at configuration time rather than at the API', () => {
    expect(() => dataTools.Config({ pageSize: 0 })).toThrow('$.pageSize expected number >= 1 but got 0')
  })

  // Every listing that reads `pageSize`, not the first one. The name said
  // "every" while the body asserted `cloudflare_kv_namespace_list` alone, so
  // the other two could have ignored the setting entirely and stayed green.
  it.each([
    ['cloudflare_kv_namespace_list', {}],
    ['cloudflare_d1_list', {}],
    ['cloudflare_r2_bucket_list', {}],
  ])('applies a configured page size to %s', async (name, args) => {
    const h = makeHarness(dataTools, async () => envelope([]), {}, { pageSize: 7 })
    await h.run(name, args)
    expect(h.requests[0]!.url).toContain('per_page=7')
  })

  it('offers a page size on exactly those three listings, so a fourth cannot slip past them', () => {
    // Read from the registry rather than remembered: a new paged listing makes
    // this fail, which is what forces it into the cases above. A list nobody
    // has to update is checkable by omission.
    const h = makeHarness(dataTools, async () => envelope([]), {}, {})
    const offersPageSize = h
      .names()
      .filter((name) => Object.keys(h.tool(name).parameters.properties ?? {}).includes('perPage'))
    expect(offersPageSize.toSorted()).toEqual([
      'cloudflare_d1_list',
      'cloudflare_kv_namespace_list',
      'cloudflare_r2_bucket_list',
    ])
  })

  it('applies a configured key list limit', async () => {
    const h = makeHarness(dataTools, async () => envelope([]), {}, { keyListLimit: 3 })
    await h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })
    expect(h.requests[0]!.url).toContain('limit=3')
  })

  it('states the configured default in the parameter description the model reads', () => {
    const h = makeHarness(dataTools, async () => envelope([]), {}, { pageSize: 7 })
    expect(h.tool('cloudflare_kv_namespace_list').parameters).toMatchObject({
      properties: { perPage: { description: 'Namespaces per page (default 7).' } },
    })
  })

  it('applies a configured render limit to KV values', () => {
    const h = makeHarness(dataTools, async () => new Response('v'), {}, { renderLimit: 5 })
    const blocks = h.render(
      'cloudflare_kv_get',
      { namespaceId: 'n', key: 'k' },
      { key: 'k', value: 'x'.repeat(12) },
    )
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 7 characters') }])
  })
})

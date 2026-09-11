/**
 * Vectorize tools: index listing, query, and the three batch operations whose
 * empty-batch refusals keep no-op requests off the wire.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../../src/tools/_shared/render.ts'
import * as aiTools from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('Vectorize tools', () => {
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

  it.each([
    ['cloudflare_vectorize_delete', 'delete'],
    ['cloudflare_vectorize_get', 'read'],
  ])('refuses %s naming no ids, which would do nothing', async (name) => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(h.run(name, { indexName: 'idx', ids: [] })).rejects.toThrow(
      'ids must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('reads vectors back by id', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ id: 'a', values: [0.1] }]))
    await expect(h.run('cloudflare_vectorize_get', { indexName: 'idx', ids: ['a'] })).resolves.toEqual({
      vectors: [{ id: 'a', values: [0.1] }],
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/vectorize/v2/indexes/idx/get_by_ids')
    await expect(h.requests[0]!.text()).resolves.toBe('{"ids":["a"]}')
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

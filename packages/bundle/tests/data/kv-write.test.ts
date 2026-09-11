/**
 * The Workers KV write tools: the bulk write and delete, their outcome
 * reporting, and the renderings the model reads back.
 */
import { describe, expect, it } from 'vitest'
import * as dataTools from '../../src/tools/data/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('cloudflare_kv_put', () => {
  it('refuses an empty batch rather than issuing a request that does nothing', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_put', { namespaceId: 'n', entries: [] })).rejects.toThrow(
      'entries must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('writes pairs through the bulk endpoint and reports what Cloudflare answered', async () => {
    const h = makeHarness(dataTools, async () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ requested: 1, written: 1, failed: [] })
    expect(h.requests[0]!.method).toBe('PUT')
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/bulk')
  })

  it('reports the keys Cloudflare could not write, rather than the size of the request', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope({ successful_key_count: 1, unsuccessful_keys: ['b'] }),
    )
    await expect(
      h.run('cloudflare_kv_put', {
        namespaceId: 'n1',
        entries: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
        ],
      }),
    ).resolves.toEqual({ requested: 2, written: 1, failed: ['b'] })
  })

  it('reports a count of zero as zero, not as an absent count', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope({ successful_key_count: 0, unsuccessful_keys: ['a'] }),
    )
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ requested: 1, written: 0, failed: ['a'] })
  })

  // Cloudflare's result schema makes both outcome fields optional and its SDK
  // types the result as nullable, so a bare acknowledgement is a success that
  // reported nothing — and is returned as exactly that.
  it.each([
    ['a null result', null],
    ['an empty result', {}],
  ])('reports %s as an acknowledgement without an outcome, inventing no count', async (_label, result) => {
    const h = makeHarness(dataTools, async () => envelope(result))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ requested: 1, written: null, failed: null })
  })

  it('passes a count through without a failed-key list', async () => {
    const h = makeHarness(dataTools, async () => envelope({ successful_key_count: 1 }))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ requested: 1, written: 1, failed: null })
  })

  it('passes a failed-key list through without a count', async () => {
    const h = makeHarness(dataTools, async () => envelope({ unsuccessful_keys: ['a'] }))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ requested: 1, written: null, failed: ['a'] })
  })

  it.each([
    ['a string result', 'ok', 'the result is neither an object nor null'],
    ['an array result', [], 'the result is neither an object nor null'],
    ['a fractional count', { successful_key_count: 1.5 }, 'successful_key_count is not an integer'],
    ['a count given as a string', { successful_key_count: '1' }, 'successful_key_count is not an integer'],
    [
      'a failed-key list holding a number',
      { unsuccessful_keys: [1] },
      'unsuccessful_keys is not an array of strings',
    ],
    [
      'a failed-key list that is not a list',
      { unsuccessful_keys: 'a' },
      'unsuccessful_keys is not an array of strings',
    ],
  ])('rejects %s as a malformed result rather than guessing', async (_label, result, problem) => {
    const h = makeHarness(dataTools, async () => envelope(result))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).rejects.toThrow(`the KV bulk result is not the shape Cloudflare declares: ${problem}`)
  })

  it('names the malformed-result failure so a caller can tell it from a provider failure', () => {
    expect(new dataTools.KvBulkResultShapeError('x')).toMatchObject({ name: 'KvBulkResultShapeError' })
  })

  it('sends the pairs as the request body', async () => {
    const h = makeHarness(dataTools, async () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }))
    await h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] })
    await expect(h.requests[0]!.text()).resolves.toBe('[{"key":"a","value":"1"}]')
  })

  it('renders the count Cloudflare reported against the request', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_put',
      { namespaceId: 'n', entries: [] },
      { requested: 3, written: 3, failed: [] },
    )
    expect(blocks).toEqual([{ type: 'text', text: 'Wrote 3 of 3 key/value pairs.' }])
  })

  it('renders the failed keys with the advice to retry them', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_put',
      { namespaceId: 'n', entries: [] },
      { requested: 3, written: 1, failed: ['b', 'c'] },
    )
    expect(blocks).toEqual([
      { type: 'text', text: 'Wrote 1 of 3 key/value pairs. 2 keys failed and should be retried: b, c.' },
    ])
  })

  it('renders an acknowledgement without an outcome as exactly that', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_put',
      { namespaceId: 'n', entries: [] },
      { requested: 1, written: null, failed: null },
    )
    expect(blocks).toEqual([
      { type: 'text', text: 'Cloudflare accepted 1 key/value pair without reporting how many it wrote.' },
    ])
  })
})

describe('cloudflare_kv_delete', () => {
  it('refuses an empty batch rather than issuing a request that does nothing', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n', keys: [] })).rejects.toThrow(
      'keys must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('uses the bulk endpoint even for one key, so Cloudflare can report the outcome', async () => {
    const h = makeHarness(dataTools, async () => envelope({ successful_key_count: 1, unsuccessful_keys: [] }))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a'] })).resolves.toEqual({
      requested: 1,
      deleted: 1,
      failed: [],
    })
    expect(h.requests[0]!.method).toBe('POST')
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/bulk/delete')
    await expect(h.requests[0]!.text()).resolves.toBe('["a"]')
  })

  it('reports the keys Cloudflare could not delete', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope({ successful_key_count: 1, unsuccessful_keys: ['b'] }),
    )
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a', 'b'] })).resolves.toEqual({
      requested: 2,
      deleted: 1,
      failed: ['b'],
    })
  })

  it('reports a bare acknowledgement without inventing a count', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a'] })).resolves.toEqual({
      requested: 1,
      deleted: null,
      failed: null,
    })
  })

  it('rejects a malformed result rather than guessing', async () => {
    const h = makeHarness(dataTools, async () => envelope({ successful_key_count: 'one' }))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a'] })).rejects.toThrow(
      'the KV bulk result is not the shape Cloudflare declares: successful_key_count is not an integer',
    )
  })

  it('renders the count Cloudflare reported against the request', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_delete',
      { namespaceId: 'n', keys: [] },
      { requested: 2, deleted: 2, failed: [] },
    )
    expect(blocks).toEqual([{ type: 'text', text: 'Deleted 2 of 2 keys.' }])
  })

  it('renders the failed key with the advice to retry it', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_delete',
      { namespaceId: 'n', keys: [] },
      { requested: 2, deleted: 1, failed: ['b'] },
    )
    expect(blocks).toEqual([
      { type: 'text', text: 'Deleted 1 of 2 keys. 1 key failed and should be retried: b.' },
    ])
  })

  it('renders an acknowledgement without an outcome as exactly that', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.render(
      'cloudflare_kv_delete',
      { namespaceId: 'n', keys: [] },
      { requested: 1, deleted: null, failed: null },
    )
    expect(blocks).toEqual([
      { type: 'text', text: 'Cloudflare accepted 1 key without reporting how many it deleted.' },
    ])
  })
})

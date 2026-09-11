/**
 * The Workers KV read tools: namespace paging, key listing and its cursor,
 * value reads, and the empty-batch refusal they share.
 */
import { describe, expect, it } from 'vitest'
import { EmptyBatchError } from '../../src/tools/_shared/batch.ts'
import * as dataTools from '../../src/tools/data/index.ts'
import { envelope, failure, makeHarness } from '../harness.ts'

describe('cloudflare_kv_namespace_list', () => {
  const info = { count: 1, page: 1, per_page: 50, total_count: 1 }

  it('returns the namespaces with the page outcome the API reported', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ id: 'n1', title: 'One' }], info))
    await expect(h.run('cloudflare_kv_namespace_list', {})).resolves.toEqual({
      namespaces: [{ id: 'n1', title: 'One' }],
      page: 1,
      perPage: 50,
      total: 1,
      complete: true,
    })
  })

  it('asks for the first page of 50 by default', async () => {
    const h = makeHarness(dataTools, async () => envelope([], info))
    await h.run('cloudflare_kv_namespace_list', {})
    expect(h.requests[0]!.url).toBe(
      'https://api.test/v4/accounts/a1/storage/kv/namespaces?page=1&per_page=50',
    )
  })

  it('honours an explicit page and page size', async () => {
    const h = makeHarness(dataTools, async () => envelope([], { ...info, page: 3, per_page: 5 }))
    await expect(h.run('cloudflare_kv_namespace_list', { page: 3, perPage: 5 })).resolves.toMatchObject({
      page: 3,
      perPage: 5,
    })
    expect(h.requests[0]!.url).toContain('page=3&per_page=5')
  })

  it('says when more pages follow', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope([{ id: 'n1' }, { id: 'n2' }], { ...info, total_count: 5 }),
    )
    await expect(h.run('cloudflare_kv_namespace_list', { perPage: 2 })).resolves.toMatchObject({
      total: 5,
      complete: false,
    })
  })

  it('refuses a page before the first without a request', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await expect(h.run('cloudflare_kv_namespace_list', { page: 0 })).rejects.toThrow(
      'page must be 1 or more, got 0',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders the count with its page context, then the payload', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.render(
      'cloudflare_kv_namespace_list',
      {},
      { namespaces: [{ id: 'n1' }], page: 2, perPage: 1, total: 3, complete: false },
    )
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('1 namespace (page 2 of 3)') }])
  })
})

describe('cloudflare_kv_list_keys', () => {
  it('lists keys with the default limit', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ name: 'a' }]))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).resolves.toEqual({
      keys: [{ name: 'a' }],
      cursor: '',
      complete: true,
    })
    expect(h.requests[0]!.url).toContain('limit=1000')
  })

  it('passes a prefix filter through', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_kv_list_keys', { namespaceId: 'n1', prefix: 'user:', limit: 10 })
    expect(h.requests[0]!.url).toContain('prefix=user%3A')
    expect(h.requests[0]!.url).toContain('limit=10')
  })

  it('renders a key count', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.render(
      'cloudflare_kv_list_keys',
      { namespaceId: 'n' },
      { keys: [], cursor: '', complete: true },
    )
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('0 keys') }])
  })
})

describe('cloudflare_kv_list_keys paging', () => {
  it('hands back the cursor the API returned, so a caller can page', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ name: 'a' }], { count: 1, cursor: 'next-1' }))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).resolves.toEqual({
      keys: [{ name: 'a' }],
      cursor: 'next-1',
      complete: false,
    })
  })

  it('reports a complete listing when the API sends no cursor', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ name: 'a' }], { count: 1 }))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).resolves.toEqual({
      keys: [{ name: 'a' }],
      cursor: '',
      complete: true,
    })
  })

  it('reports a complete listing when the API sends an empty cursor', async () => {
    const h = makeHarness(dataTools, async () => envelope([], { count: 0, cursor: '' }))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).resolves.toMatchObject({
      complete: true,
    })
  })

  it('sends a caller-supplied cursor on the wire', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_kv_list_keys', { namespaceId: 'n1', cursor: 'next-1' })
    expect(h.requests[0]!.url).toContain('cursor=next-1')
  })

  it('refuses a cursor that is not a string rather than ending the listing early', async () => {
    const h = makeHarness(dataTools, async () => envelope([], { cursor: 7 }))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).rejects.toThrow(
      'result_info.cursor must be a string, got number',
    )
  })
})

describe('cloudflare_kv_get', () => {
  it('returns the raw stored value, not an envelope', async () => {
    const h = makeHarness(dataTools, async () => new Response('the-value', { status: 200 }))
    await expect(h.run('cloudflare_kv_get', { namespaceId: 'n1', key: 'k' })).resolves.toEqual({
      key: 'k',
      value: 'the-value',
    })
  })

  it('reads from the value path', async () => {
    const h = makeHarness(dataTools, async () => new Response('v'))
    await h.run('cloudflare_kv_get', { namespaceId: 'n1', key: 'my/key' })
    expect(h.requests[0]!.url).toBe(
      'https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/values/my%2Fkey',
    )
  })

  it('renders the key then the value', () => {
    const h = makeHarness(dataTools, async () => new Response('v'))
    const blocks = h.render('cloudflare_kv_get', { namespaceId: 'n', key: 'k' }, { key: 'k', value: 'v' })
    expect(blocks).toEqual([{ type: 'text', text: 'k\nv' }])
  })

  it('truncates a very large value for display', () => {
    const h = makeHarness(dataTools, async () => new Response('v'))
    const big = 'x'.repeat(5000)
    const blocks = h.render('cloudflare_kv_get', { namespaceId: 'n', key: 'k' }, { key: 'k', value: big })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 1000 characters') }])
  })

  it('surfaces a missing key as an error', async () => {
    const h = makeHarness(dataTools, async () => failure(10009, "get: 'key not found'", 404))
    await expect(h.run('cloudflare_kv_get', { namespaceId: 'n1', key: 'nope' })).rejects.toThrow(
      "[10009] get: 'key not found'",
    )
  })
})

describe('cloudflare_kv_get, when the edge answers instead of the API', () => {
  it('reads the status and the page the model would otherwise never see', async () => {
    const h = makeHarness(dataTools, async () => new Response('<html>not found</html>', { status: 404 }))
    await expect(h.run('cloudflare_kv_get', { namespaceId: 'n1', key: 'nope' })).rejects.toThrow(
      'HTTP 404 without a Cloudflare envelope: <html>not found</html>',
    )
  })
})

describe('EmptyBatchError', () => {
  it('names itself and the field, so the refusal is identifiable in a log', () => {
    expect(new EmptyBatchError('keys')).toMatchObject({
      name: 'EmptyBatchError',
      message: 'keys must name at least one item; an empty request would do nothing',
    })
  })
})

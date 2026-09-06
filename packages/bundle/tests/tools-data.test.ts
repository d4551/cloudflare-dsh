import { describe, expect, it } from 'vitest'
import { json } from '../src/tools/_shared/render.ts'
import * as dataTools from '../src/tools/data.ts'
import { envelope, failure, makeHarness } from './harness.ts'

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
    expect(new dataTools.EmptyBatchError('keys')).toMatchObject({
      name: 'EmptyBatchError',
      message: 'keys must name at least one item; an empty request would do nothing',
    })
  })
})

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

describe('cloudflare_d1_list and cloudflare_d1_query', () => {
  it('lists databases with the page outcome the API reported', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope([{ uuid: 'db1', name: 'main' }], { count: 1, page: 1, per_page: 50, total_count: 1 }),
    )
    await expect(h.run('cloudflare_d1_list', {})).resolves.toEqual({
      databases: [{ uuid: 'db1', name: 'main' }],
      page: 1,
      perPage: 50,
      total: 1,
      complete: true,
    })
  })

  it('asks for the first page of 50 databases by default', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_d1_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/d1/database?page=1&per_page=50')
  })

  it('honours an explicit page', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_d1_list', { page: 2 })
    expect(h.requests[0]!.url).toContain('page=2&per_page=50')
  })

  it('renders a database count with its page context', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.render(
      'cloudflare_d1_list',
      {},
      { databases: [{}, {}], page: 1, perPage: 50, total: null, complete: true },
    )
    expect(blocks).toEqual([
      { type: 'text', text: expect.stringContaining('2 databases (page 1, the last)') },
    ])
  })

  it('runs a query and returns its result sets', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ results: [{ n: 1 }], success: true }]))
    await expect(h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT 1' })).resolves.toEqual({
      results: [{ results: [{ n: 1 }], success: true }],
    })
  })

  it('defaults params to an empty array', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT 1' })
    await expect(h.requests[0]!.text()).resolves.toBe('{"sql":"SELECT 1","params":[]}')
  })

  it('passes bound parameters through', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT ?', params: ['x'] })
    await expect(h.requests[0]!.text()).resolves.toBe('{"sql":"SELECT ?","params":["x"]}')
  })

  it('renders the result as JSON', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.render('cloudflare_d1_query', { databaseId: 'd', sql: 's' }, { results: [] })
    expect(blocks).toEqual(json({ results: [] }))
  })

  it('surfaces a SQL error from Cloudflare', async () => {
    const h = makeHarness(dataTools, async () => failure(7500, 'no such table: nope'))
    await expect(
      h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT * FROM nope' }),
    ).rejects.toThrow('no such table: nope')
  })
})

describe('queue tools', () => {
  it('lists queues, complete when the API reports no total', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ queue_id: 'q1' }]))
    await expect(h.run('cloudflare_queue_list', {})).resolves.toEqual({
      queues: [{ queue_id: 'q1' }],
      total: null,
      complete: true,
    })
  })

  it('sends no paging parameters, since the endpoint has none', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_queue_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/queues')
  })

  it('says when the API reports more queues than it returned', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ queue_id: 'q1' }], { total_count: 3 }))
    await expect(h.run('cloudflare_queue_list', {})).resolves.toMatchObject({ total: 3, complete: false })
  })

  it('renders a queue count, noting an incomplete listing', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    expect(h.render('cloudflare_queue_list', {}, { queues: [{}], total: null, complete: true })).toEqual([
      { type: 'text', text: expect.stringContaining('1 queue\n') },
    ])
    expect(h.render('cloudflare_queue_list', {}, { queues: [{}], total: 3, complete: false })).toEqual([
      { type: 'text', text: expect.stringContaining('1 queue (the API reports 3 in all)') },
    ])
  })

  it('sends a message wrapped in a body envelope', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_queue_send', { queueId: 'q1', body: { a: 1 } })).resolves.toEqual({
      queued: true,
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"body":{"a":1}}')
  })

  it('renders a send acknowledgement', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.render('cloudflare_queue_send', { queueId: 'q', body: null }, { queued: true })).toEqual([
      { type: 'text', text: 'Message queued.' },
    ])
  })

  it('pulls messages with defaults', async () => {
    const h = makeHarness(dataTools, async () => envelope({ messages: [{ lease_id: 'l1' }] }))
    await expect(h.run('cloudflare_queue_pull', { queueId: 'q1' })).resolves.toEqual({
      messages: [{ lease_id: 'l1' }],
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"batch_size":10,"visibility_timeout_ms":30000}')
  })

  it('honours explicit pull options', async () => {
    const h = makeHarness(dataTools, async () => envelope({ messages: [] }))
    await h.run('cloudflare_queue_pull', { queueId: 'q1', batchSize: 3, visibilityTimeoutMs: 1000 })
    await expect(h.requests[0]!.text()).resolves.toBe('{"batch_size":3,"visibility_timeout_ms":1000}')
  })

  it('treats a missing messages field as an empty batch', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await expect(h.run('cloudflare_queue_pull', { queueId: 'q1' })).resolves.toEqual({ messages: [] })
  })

  it('renders a pulled message count', () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    expect(h.render('cloudflare_queue_pull', { queueId: 'q' }, { messages: [] })).toEqual([
      { type: 'text', text: expect.stringContaining('0 messages') },
    ])
  })

  it('refuses a settlement that names no lease, rather than posting an empty one', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_queue_ack', { queueId: 'q' })).rejects.toThrow(
      'acks or retries must name at least one item; an empty request would do nothing',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('acknowledges and retries by lease id', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(
      h.run('cloudflare_queue_ack', { queueId: 'q1', acks: ['l1'], retries: ['l2'] }),
    ).resolves.toEqual({ acked: 1, retried: 1 })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"acks":[{"lease_id":"l1"}],"retries":[{"lease_id":"l2"}]}',
    )
  })

  it('renders acknowledgement counts', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.render('cloudflare_queue_ack', { queueId: 'q' }, { acked: 2, retried: 1 })).toEqual([
      { type: 'text', text: 'Acknowledged 2, retried 1.' },
    ])
  })
})

describe('r2 bucket tools', () => {
  it('lists buckets, complete when the API sends no cursor', async () => {
    const h = makeHarness(dataTools, async () => envelope({ buckets: [{ name: 'media' }] }))
    await expect(h.run('cloudflare_r2_bucket_list', {})).resolves.toEqual({
      buckets: [{ name: 'media' }],
      cursor: '',
      complete: true,
    })
  })

  it('hands back the cursor the API sends for the next page', async () => {
    const h = makeHarness(dataTools, async () =>
      envelope({ buckets: [{ name: 'a' }] }, { cursor: 'c2', per_page: 1 }),
    )
    await expect(h.run('cloudflare_r2_bucket_list', { perPage: 1 })).resolves.toEqual({
      buckets: [{ name: 'a' }],
      cursor: 'c2',
      complete: false,
    })
  })

  it('continues from a cursor', async () => {
    const h = makeHarness(dataTools, async () => envelope({ buckets: [] }))
    await h.run('cloudflare_r2_bucket_list', { cursor: 'c2' })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/r2/buckets?per_page=50&cursor=c2')
  })

  it('treats a missing buckets field as empty', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await expect(h.run('cloudflare_r2_bucket_list', {})).resolves.toMatchObject({ buckets: [] })
  })

  it('defaults to 50 buckets per page and no cursor', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await h.run('cloudflare_r2_bucket_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/r2/buckets?per_page=50')
  })

  it('renders a bucket count, noting when more follow', () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    expect(h.render('cloudflare_r2_bucket_list', {}, { buckets: [{}], cursor: '', complete: true })).toEqual([
      { type: 'text', text: expect.stringContaining('1 bucket\n') },
    ])
    expect(
      h.render('cloudflare_r2_bucket_list', {}, { buckets: [{}], cursor: 'c2', complete: false }),
    ).toEqual([{ type: 'text', text: expect.stringContaining('1 bucket (more follow the cursor)') }])
  })

  it('creates a bucket', async () => {
    const h = makeHarness(dataTools, async () => envelope({ name: 'media' }))
    await expect(h.run('cloudflare_r2_bucket_create', { name: 'media' })).resolves.toEqual({
      bucket: { name: 'media' },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"name":"media"}')
  })

  it('passes a location hint when given', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await h.run('cloudflare_r2_bucket_create', { name: 'media', locationHint: 'weur' })
    await expect(h.requests[0]!.text()).resolves.toBe('{"name":"media","locationHint":"weur"}')
  })

  it('renders the created bucket name from the arguments', () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    expect(h.render('cloudflare_r2_bucket_create', { name: 'media' }, { bucket: {} })).toEqual([
      { type: 'text', text: 'Created R2 bucket media.' },
    ])
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

  it('applies a configured page size to every paged listing', async () => {
    const h = makeHarness(dataTools, async () => envelope([]), {}, { pageSize: 7 })
    await h.run('cloudflare_kv_namespace_list', {})
    expect(h.requests[0]!.url).toContain('per_page=7')
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

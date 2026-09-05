import { describe, expect, it } from 'vitest'
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
    expect([...h.tools.keys()].toSorted()).toEqual([...EXPECTED_TOOLS].toSorted())
  })

  it('gives every tool a description and an output schema', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    for (const name of EXPECTED_TOOLS) {
      const tool = h.tool(name)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.output.schema).toBeDefined()
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
  it('returns the namespaces', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ id: 'n1', title: 'One' }]))
    await expect(h.run('cloudflare_kv_namespace_list', {})).resolves.toEqual({
      namespaces: [{ id: 'n1', title: 'One' }],
    })
  })

  it('defaults to 50 per page', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_kv_namespace_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces?per_page=50')
  })

  it('honours an explicit page size', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_kv_namespace_list', { perPage: 5 })
    expect(h.requests[0]!.url).toContain('per_page=5')
  })

  it('renders a count and the payload', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.tool('cloudflare_kv_namespace_list').output.render({}, { namespaces: [{ id: 'n1' }] })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('1 namespace') }])
  })
})

describe('cloudflare_kv_list_keys', () => {
  it('lists keys with the default limit', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ name: 'a' }]))
    await expect(h.run('cloudflare_kv_list_keys', { namespaceId: 'n1' })).resolves.toEqual({
      keys: [{ name: 'a' }],
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
    const blocks = h.tool('cloudflare_kv_list_keys').output.render({ namespaceId: 'n' }, { keys: [] })
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
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/values/my%2Fkey')
  })

  it('renders the key then the value', () => {
    const h = makeHarness(dataTools, async () => new Response('v'))
    const blocks = h.tool('cloudflare_kv_get').output.render({ namespaceId: 'n', key: 'k' }, { key: 'k', value: 'v' })
    expect(blocks).toEqual([{ type: 'text', text: 'k\nv' }])
  })

  it('truncates a very large value for display', () => {
    const h = makeHarness(dataTools, async () => new Response('v'))
    const big = 'x'.repeat(5000)
    const blocks = h.tool('cloudflare_kv_get').output.render({ namespaceId: 'n', key: 'k' }, { key: 'k', value: big })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 1000 characters') }])
  })

  it('surfaces a missing key as an error', async () => {
    const h = makeHarness(dataTools, async () => new Response('not found', { status: 404 }))
    await expect(h.run('cloudflare_kv_get', { namespaceId: 'n1', key: 'nope' })).rejects.toThrow()
  })
})

describe('cloudflare_kv_put', () => {
  it('writes pairs through the bulk endpoint and reports the count', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(
      h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] }),
    ).resolves.toEqual({ written: 1 })
    expect(h.requests[0]!.method).toBe('PUT')
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/bulk')
  })

  it('sends the pairs as the request body', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await h.run('cloudflare_kv_put', { namespaceId: 'n1', entries: [{ key: 'a', value: '1' }] })
    await expect(h.requests[0]!.text()).resolves.toBe('[{"key":"a","value":"1"}]')
  })

  it('renders how many pairs were written', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.tool('cloudflare_kv_put').output.render({ namespaceId: 'n', entries: [] }, { written: 3 })
    expect(blocks).toEqual([{ type: 'text', text: 'Wrote 3 key/value pairs.' }])
  })
})

describe('cloudflare_kv_delete', () => {
  it('uses the single-key endpoint for one key', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a'] })).resolves.toEqual({
      deleted: 1,
    })
    expect(h.requests[0]!.method).toBe('DELETE')
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/values/a')
  })

  it('uses the bulk endpoint for several keys', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: ['a', 'b'] })).resolves.toEqual({
      deleted: 2,
    })
    expect(h.requests[0]!.method).toBe('POST')
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/storage/kv/namespaces/n1/bulk/delete')
  })

  it('uses the bulk endpoint for an empty list rather than a malformed single delete', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_kv_delete', { namespaceId: 'n1', keys: [] })).resolves.toEqual({
      deleted: 0,
    })
    expect(h.requests[0]!.url).toContain('/bulk/delete')
  })

  it('renders how many keys were deleted', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    const blocks = h.tool('cloudflare_kv_delete').output.render({ namespaceId: 'n', keys: [] }, { deleted: 2 })
    expect(blocks).toEqual([{ type: 'text', text: 'Deleted 2 keys.' }])
  })
})

describe('cloudflare_d1_list and cloudflare_d1_query', () => {
  it('lists databases', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ uuid: 'db1', name: 'main' }]))
    await expect(h.run('cloudflare_d1_list', {})).resolves.toEqual({
      databases: [{ uuid: 'db1', name: 'main' }],
    })
  })

  it('defaults to 50 databases per page', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_d1_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/d1/database?per_page=50')
  })

  it('renders a database count', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    const blocks = h.tool('cloudflare_d1_list').output.render({}, { databases: [{}, {}] })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('2 databases') }])
  })

  it('runs a query and returns its result sets', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ results: [{ n: 1 }], success: true }]))
    await expect(
      h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT 1' }),
    ).resolves.toEqual({ results: [{ results: [{ n: 1 }], success: true }] })
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
    const blocks = h.tool('cloudflare_d1_query').output.render({ databaseId: 'd', sql: 's' }, { results: [] })
    expect(blocks).toEqual([{ type: 'text', text: '{\n  "results": []\n}' }])
  })

  it('surfaces a SQL error from Cloudflare', async () => {
    const h = makeHarness(dataTools, async () => failure(7500, 'no such table: nope'))
    await expect(h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT * FROM nope' })).rejects.toThrow(
      'no such table: nope',
    )
  })
})

describe('queue tools', () => {
  it('lists queues', async () => {
    const h = makeHarness(dataTools, async () => envelope([{ queue_id: 'q1' }]))
    await expect(h.run('cloudflare_queue_list', {})).resolves.toEqual({ queues: [{ queue_id: 'q1' }] })
  })

  it('defaults to 50 queues per page', async () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    await h.run('cloudflare_queue_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/queues?per_page=50')
  })

  it('renders a queue count', () => {
    const h = makeHarness(dataTools, async () => envelope([]))
    expect(h.tool('cloudflare_queue_list').output.render({}, { queues: [{}] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 queue') },
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
    expect(h.tool('cloudflare_queue_send').output.render({ queueId: 'q', body: null }, { queued: true })).toEqual([
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
    expect(h.tool('cloudflare_queue_pull').output.render({ queueId: 'q' }, { messages: [] })).toEqual([
      { type: 'text', text: expect.stringContaining('0 messages') },
    ])
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

  it('defaults both lease lists to empty', async () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    await expect(h.run('cloudflare_queue_ack', { queueId: 'q1' })).resolves.toEqual({ acked: 0, retried: 0 })
  })

  it('renders acknowledgement counts', () => {
    const h = makeHarness(dataTools, async () => envelope(null))
    expect(h.tool('cloudflare_queue_ack').output.render({ queueId: 'q' }, { acked: 2, retried: 1 })).toEqual([
      { type: 'text', text: 'Acknowledged 2, retried 1.' },
    ])
  })
})

describe('r2 bucket tools', () => {
  it('lists buckets', async () => {
    const h = makeHarness(dataTools, async () => envelope({ buckets: [{ name: 'media' }] }))
    await expect(h.run('cloudflare_r2_bucket_list', {})).resolves.toEqual({ buckets: [{ name: 'media' }] })
  })

  it('treats a missing buckets field as empty', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await expect(h.run('cloudflare_r2_bucket_list', {})).resolves.toEqual({ buckets: [] })
  })

  it('defaults to 50 buckets per page', async () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    await h.run('cloudflare_r2_bucket_list', {})
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/r2/buckets?per_page=50')
  })

  it('renders a bucket count', () => {
    const h = makeHarness(dataTools, async () => envelope({}))
    expect(h.tool('cloudflare_r2_bucket_list').output.render({}, { buckets: [{}] })).toEqual([
      { type: 'text', text: expect.stringContaining('1 bucket') },
    ])
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
    expect(h.tool('cloudflare_r2_bucket_create').output.render({ name: 'media' }, { bucket: {} })).toEqual([
      { type: 'text', text: 'Created R2 bucket media.' },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  d1ListSpec,
  d1QuerySpec,
  kvBulkDeleteSpec,
  kvBulkPutSpec,
  kvDeleteSpec,
  kvListKeysSpec,
  kvNamespaceListSpec,
  kvValuePath,
  queueAckSpec,
  queueListSpec,
  queuePullSpec,
  queueSendSpec,
  r2BucketCreateSpec,
  r2BucketListSpec,
} from '../src/specs/data.ts'

describe('KV specs', () => {
  it('lists namespaces with the requested page size', () => {
    expect(kvNamespaceListSpec(50)).toEqual({
      method: 'GET',
      path: '/storage/kv/namespaces',
      query: { per_page: 50 },
    })
  })

  it('builds a value path', () => {
    expect(kvValuePath('ns1', 'my-key')).toBe('/storage/kv/namespaces/ns1/values/my-key')
  })

  it('percent-encodes namespace and key so slashes cannot escape the path', () => {
    expect(kvValuePath('ns/1', 'a/b')).toBe('/storage/kv/namespaces/ns%2F1/values/a%2Fb')
  })

  it('encodes a key containing a question mark rather than starting a query', () => {
    expect(kvValuePath('ns', 'a?b=c')).toBe('/storage/kv/namespaces/ns/values/a%3Fb%3Dc')
  })

  it('lists keys with a limit and no undefined-valued keys in the spec', () => {
    expect(kvListKeysSpec('ns1', undefined, 100, undefined)).toStrictEqual({
      method: 'GET',
      path: '/storage/kv/namespaces/ns1/keys',
      query: { limit: 100 },
    })
  })

  it('includes the prefix filter only when one is given', () => {
    expect(kvListKeysSpec('ns1', 'user:', 10, undefined).query).toEqual({ limit: 10, prefix: 'user:' })
  })

  it('deletes a key', () => {
    expect(kvDeleteSpec('ns1', 'k')).toEqual({
      method: 'DELETE',
      path: '/storage/kv/namespaces/ns1/values/k',
    })
  })

  it('bulk-writes key/value pairs', () => {
    expect(kvBulkPutSpec('ns1', [{ key: 'a', value: '1' }])).toEqual({
      method: 'PUT',
      path: '/storage/kv/namespaces/ns1/bulk',
      body: [{ key: 'a', value: '1' }],
    })
  })

  it('drops extra fields from bulk-write entries', () => {
    const spec = kvBulkPutSpec('ns1', [
      { key: 'a', value: '1', extra: 'x' } as { key: string; value: string },
    ])
    expect(spec.body).toEqual([{ key: 'a', value: '1' }])
  })

  it('bulk-deletes keys', () => {
    expect(kvBulkDeleteSpec('ns1', ['a', 'b'])).toEqual({
      method: 'POST',
      path: '/storage/kv/namespaces/ns1/bulk/delete',
      body: ['a', 'b'],
    })
  })
})

describe('KV key paging', () => {
  it('carries the cursor a previous page returned', () => {
    expect(kvListKeysSpec('ns1', undefined, 1000, 'abc').query).toStrictEqual({ limit: 1000, cursor: 'abc' })
  })

  it('sends no cursor parameter on the first page', () => {
    expect(kvListKeysSpec('ns1', undefined, 1000, undefined).query).toStrictEqual({ limit: 1000 })
  })
})

describe('D1 specs', () => {
  it('lists databases against the singular resource path', () => {
    expect(d1ListSpec(25)).toEqual({ method: 'GET', path: '/d1/database', query: { per_page: 25 } })
  })

  it('posts sql and params to the query endpoint', () => {
    expect(d1QuerySpec('db1', 'SELECT 1', [])).toEqual({
      method: 'POST',
      path: '/d1/database/db1/query',
      body: { sql: 'SELECT 1', params: [] },
    })
  })

  it('passes bound parameters through', () => {
    expect(d1QuerySpec('db1', 'SELECT ?', ['x']).body).toEqual({ sql: 'SELECT ?', params: ['x'] })
  })

  it('encodes the database id', () => {
    expect(d1QuerySpec('db/1', 'SELECT 1', []).path).toBe('/d1/database/db%2F1/query')
  })
})

describe('Queue specs', () => {
  it('lists queues', () => {
    expect(queueListSpec(20)).toEqual({ method: 'GET', path: '/queues', query: { per_page: 20 } })
  })

  it('wraps a sent message in a body envelope', () => {
    expect(queueSendSpec('q1', { hello: 'world' })).toEqual({
      method: 'POST',
      path: '/queues/q1/messages',
      body: { body: { hello: 'world' } },
    })
  })

  it('pulls with a batch size and visibility timeout', () => {
    expect(queuePullSpec('q1', 10, 30_000)).toEqual({
      method: 'POST',
      path: '/queues/q1/messages/pull',
      body: { batch_size: 10, visibility_timeout_ms: 30_000 },
    })
  })

  it('acknowledges by lease id', () => {
    expect(queueAckSpec('q1', ['l1', 'l2'], [])).toEqual({
      method: 'POST',
      path: '/queues/q1/messages/ack',
      body: { acks: [{ lease_id: 'l1' }, { lease_id: 'l2' }], retries: [] },
    })
  })

  it('requests retries by lease id', () => {
    expect(queueAckSpec('q1', [], ['l3']).body).toEqual({ acks: [], retries: [{ lease_id: 'l3' }] })
  })

  it('encodes the queue id', () => {
    expect(queueSendSpec('q/1', {}).path).toBe('/queues/q%2F1/messages')
  })
})

describe('R2 specs', () => {
  it('lists buckets', () => {
    expect(r2BucketListSpec(100)).toEqual({ method: 'GET', path: '/r2/buckets', query: { per_page: 100 } })
  })

  it('creates a bucket without emitting an undefined location hint', () => {
    expect(r2BucketCreateSpec('media', undefined)).toStrictEqual({
      method: 'POST',
      path: '/r2/buckets',
      body: { name: 'media' },
    })
  })

  it('includes a location hint only when one is given', () => {
    expect(r2BucketCreateSpec('media', 'weur').body).toEqual({ name: 'media', locationHint: 'weur' })
  })
})

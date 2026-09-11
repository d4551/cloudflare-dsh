/**
 * The Cloudflare Queues tools: listing, send, pull, and the lease settlement
 * whose empty refusal keeps a no-op POST off the wire.
 */
import { describe, expect, it } from 'vitest'
import * as dataTools from '../../src/tools/data/index.ts'
import { envelope, makeHarness } from '../harness.ts'

/**
 * The ack tool takes a parameter named `retries`, spelled here through a named
 * key so the call reads as the schema it mirrors rather than as runner
 * configuration.
 */
const RETRY_LEASES_KEY = 'retries'

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
      h.run('cloudflare_queue_ack', { queueId: 'q1', acks: ['l1'], [RETRY_LEASES_KEY]: ['l2'] }),
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

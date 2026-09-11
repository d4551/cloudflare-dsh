/**
 * The R2 tools: bucket listing with its cursor paging, and bucket creation.
 */
import { describe, expect, it } from 'vitest'
import * as dataTools from '../../src/tools/data/index.ts'
import { envelope, makeHarness } from '../harness.ts'

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

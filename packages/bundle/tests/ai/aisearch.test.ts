/**
 * AI Search tools: search, grounded chat, and the sync trigger.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../../src/tools/_shared/render.ts'
import * as aiTools from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('AI Search tools', () => {
  it('searches an instance', async () => {
    const h = makeHarness(aiTools, async () => envelope({ data: [] }))
    await expect(h.run('cloudflare_aisearch_search', { instanceId: 'i1', query: 'q' })).resolves.toEqual({
      results: { data: [] },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"query":"q","max_num_results":10}')
  })

  it('honours an explicit result limit', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_aisearch_search', {
      instanceId: 'i1',
      query: 'q',
      maxResults: 3,
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"query":"q","max_num_results":3}')
  })

  it('renders search results as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_aisearch_search', { instanceId: 'i', query: 'q' }, { results: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
  })

  it('asks for a grounded answer', async () => {
    const h = makeHarness(aiTools, async () => envelope({ choices: [] }))
    await expect(h.run('cloudflare_aisearch_chat', { instanceId: 'i1', query: 'why' })).resolves.toEqual({
      answer: { choices: [] },
    })
  })

  it('overrides the generating model when given', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_aisearch_chat', {
      instanceId: 'i1',
      query: 'why',
      model: '@cf/m',
    })
    await expect(h.requests[0]!.text()).resolves.toContain('"model":"@cf/m"')
  })

  it('renders a grounded answer as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_aisearch_chat', { instanceId: 'i', query: 'q' }, { answer: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
  })

  it('triggers a sync job', async () => {
    const h = makeHarness(aiTools, async () => envelope({ id: 'job1' }))
    await expect(h.run('cloudflare_aisearch_sync', { instanceId: 'i1' })).resolves.toEqual({
      job: { id: 'job1' },
    })
    expect(h.requests[0]!.method).toBe('POST')
  })

  it('renders the sync job as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.render('cloudflare_aisearch_sync', { instanceId: 'i' }, { job: { id: 'j' } })).toEqual(
      json({ id: 'j' }),
    )
  })
})

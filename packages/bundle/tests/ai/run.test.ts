/**
 * The model catalogue tools: search paging and the published model schema.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../../src/tools/_shared/render.ts'
import * as aiTools from '../../src/tools/ai/index.ts'
import { envelope, makeHarness } from '../harness.ts'

describe('model catalogue tools', () => {
  it('searches the first page of 50 models by default, inferring completeness from a short page', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: '@cf/m' }]))
    await expect(h.run('cloudflare_ai_models_search', {})).resolves.toEqual({
      models: [{ name: '@cf/m' }],
      page: 1,
      perPage: 50,
      total: null,
      complete: true,
    })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/models/search?page=1&per_page=50')
  })

  it('says more may follow a full page, since the catalogue reports no total', async () => {
    const h = makeHarness(aiTools, async () => envelope([{ name: '@cf/a' }, { name: '@cf/b' }]))
    await expect(h.run('cloudflare_ai_models_search', { perPage: 2 })).resolves.toMatchObject({
      total: null,
      complete: false,
    })
  })

  it('passes page, search and task filters', async () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    await h.run('cloudflare_ai_models_search', {
      search: 'llama',
      task: 'Text Generation',
      page: 2,
      perPage: 5,
    })
    const url = h.requests[0]!.url
    expect(url).toContain('search=llama')
    expect(url).toContain('task=Text+Generation')
    expect(url).toContain('page=2&per_page=5')
  })

  it('renders a model count with its page context', () => {
    const h = makeHarness(aiTools, async () => envelope([]))
    expect(
      h.render(
        'cloudflare_ai_models_search',
        {},
        { models: [{}, {}], page: 1, perPage: 2, total: null, complete: false },
      ),
    ).toEqual([{ type: 'text', text: expect.stringContaining('2 models (page 1, more may follow)') }])
  })

  it('fetches a model schema', async () => {
    const h = makeHarness(aiTools, async () => envelope({ type: 'object' }))
    await expect(h.run('cloudflare_ai_model_schema', { model: '@cf/m' })).resolves.toEqual({
      model: '@cf/m',
      schema: { type: 'object' },
    })
    expect(h.requests[0]!.url).toContain('/ai/models/schema?model=%40cf%2Fm')
  })

  it('renders the model schema as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(h.render('cloudflare_ai_model_schema', { model: 'm' }, { model: 'm', schema: { a: 1 } })).toEqual(
      json({ a: 1 }),
    )
  })
})

/**
 * The D1 tools: database listing with its page outcome, and SQL execution
 * with bound parameters and the client-table projection.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../../src/tools/_shared/render.ts'
import * as dataTools from '../../src/tools/data/index.ts'
import { envelope, failure, makeHarness } from '../harness.ts'

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

  it('publishes the query and its rows for the client table', () => {
    // The render text cannot carry the rows losslessly, so the view reads this
    // projection instead — persisted with the session log, so a replay renders
    // the same table.
    const h = makeHarness(dataTools, async () => envelope([]))
    const meta = h
      .tool('cloudflare_d1_query')
      .output.presentationMeta?.(
        { databaseId: 'd', sql: 'SELECT 1' },
        { results: [{ results: [{ id: 1 }] }] },
      )
    expect(meta).toEqual({ sql: 'SELECT 1', resultSets: [{ results: [{ id: 1 }] }] })
  })

  it('bounds a wide result set by the configured render limit', () => {
    // The budget was declared for this and applied to one tool; a wide result
    // set reached the model whole.
    const h = makeHarness(dataTools, async () => envelope([]), {}, { renderLimit: 20 })
    const results = [{ value: 'x'.repeat(200) }]
    const blocks = h.render('cloudflare_d1_query', { databaseId: 'd', sql: 's' }, { results })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated') }])
    expect(blocks[0]).toMatchObject({ text: expect.stringMatching(/^.{20}\n… truncated \d+ characters$/su) })
  })

  it('surfaces a SQL error from Cloudflare', async () => {
    const h = makeHarness(dataTools, async () => failure(7500, 'no such table: nope'))
    await expect(
      h.run('cloudflare_d1_query', { databaseId: 'db1', sql: 'SELECT * FROM nope' }),
    ).rejects.toThrow('no such table: nope')
  })
})

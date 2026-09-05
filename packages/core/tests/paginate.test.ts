import { describe, expect, it, vi } from 'vitest'
import { nextCursorQuery, nextPageQuery, paginate } from '../src/paginate.ts'
import type { CloudflareEnvelope } from '../src/types.ts'

function page<T>(result: readonly T[], info?: CloudflareEnvelope['result_info']): CloudflareEnvelope<readonly T[]> {
  return info === undefined
    ? { success: true, errors: [], messages: [], result }
    : { success: true, errors: [], messages: [], result, result_info: info }
}

describe('nextCursorQuery', () => {
  it('returns the cursor overlay when one is present', () => {
    expect(nextCursorQuery({ result_info: { cursor: 'abc' } })).toEqual({ cursor: 'abc' })
  })

  it('stops on an empty cursor', () => {
    expect(nextCursorQuery({ result_info: { cursor: '' } })).toBeNull()
  })

  it('stops when the cursor key is absent', () => {
    expect(nextCursorQuery({ result_info: { page: 1 } })).toBeNull()
  })

  it('stops when result_info is absent', () => {
    expect(nextCursorQuery({})).toBeNull()
  })
})

describe('nextPageQuery', () => {
  it('advances to the next page', () => {
    expect(nextPageQuery({ result_info: { page: 1, per_page: 20, total_count: 50 } }, 20)).toEqual({
      page: 2,
      per_page: 20,
    })
  })

  it('stops once everything has been seen', () => {
    expect(nextPageQuery({ result_info: { page: 3, per_page: 20, total_count: 50 } }, 50)).toBeNull()
  })

  it('stops when more than the total has been seen', () => {
    expect(nextPageQuery({ result_info: { page: 3, per_page: 20, total_count: 50 } }, 60)).toBeNull()
  })

  it('stops when result_info is absent', () => {
    expect(nextPageQuery({}, 0)).toBeNull()
  })

  it.each([
    ['page', { per_page: 20, total_count: 50 }],
    ['per_page', { page: 1, total_count: 50 }],
    ['total_count', { page: 1, per_page: 20 }],
  ])('stops when %s is missing', (_name, info) => {
    expect(nextPageQuery({ result_info: info }, 0)).toBeNull()
  })

  it('stops when the page came back short, whatever the advertised total', () => {
    // A server that returns fewer rows than it was asked for has nothing more,
    // so continuing to the advertised total just fetches empty pages.
    expect(
      nextPageQuery({ result_info: { page: 1, per_page: 20, total_count: 50, count: 7 } }, 7),
    ).toBeNull()
  })

  it('continues while a full page comes back', () => {
    expect(
      nextPageQuery({ result_info: { page: 1, per_page: 20, total_count: 50, count: 20 } }, 20),
    ).toEqual({ page: 2, per_page: 20 })
  })

  it('stops on a non-positive page size rather than looping forever', () => {
    expect(nextPageQuery({ result_info: { page: 1, per_page: 0, total_count: 50 } }, 0)).toBeNull()
  })
})

describe('paginate', () => {
  it('yields items from a single page', async () => {
    const fetchPage = vi.fn(async () => page(['a', 'b']))
    const items: string[] = []
    for await (const item of paginate(fetchPage, () => null, 10)) items.push(item)
    expect(items).toEqual(['a', 'b'])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('follows the cursor across pages', async () => {
    const pages = [page(['a'], { cursor: 'c1' }), page(['b'], { cursor: '' })]
    let i = 0
    const fetchPage = vi.fn(async () => pages[i++]!)
    const items: string[] = []
    for await (const item of paginate(fetchPage, nextCursorQuery, 10)) items.push(item)
    expect(items).toEqual(['a', 'b'])
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: 'c1' })
  })

  it('passes the initial query to the first fetch', async () => {
    const fetchPage = vi.fn(async () => page<string>([]))
    for await (const _ of paginate(fetchPage, () => null, 5, { per_page: 100 })) void _
    expect(fetchPage).toHaveBeenCalledWith({ per_page: 100 })
  })

  it('stops at maxPages even when the server keeps offering a cursor', async () => {
    const fetchPage = vi.fn(async () => page(['x'], { cursor: 'always' }))
    const items: string[] = []
    for await (const item of paginate(fetchPage, nextCursorQuery, 3)) items.push(item)
    expect(items).toEqual(['x', 'x', 'x'])
    expect(fetchPage).toHaveBeenCalledTimes(3)
  })

  it('reports the running count to the stepper', async () => {
    const seen: number[] = []
    const pages = [page(['a', 'b'], { cursor: 'c' }), page(['c'], { cursor: '' })]
    let i = 0
    const stepper = (env: CloudflareEnvelope<readonly unknown[]>, count: number) => {
      seen.push(count)
      return nextCursorQuery(env)
    }
    for await (const _ of paginate(async () => pages[i++]!, stepper, 10)) void _
    expect(seen).toEqual([2, 3])
  })

  it('yields nothing for an empty first page', async () => {
    const items: unknown[] = []
    for await (const item of paginate(async () => page([]), () => null, 5)) items.push(item)
    expect(items).toEqual([])
  })
})

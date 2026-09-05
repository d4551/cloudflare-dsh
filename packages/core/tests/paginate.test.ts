import { describe, expect, it, vi } from 'vitest'
import { type NextPageQuery, nextPageQuery, paginate } from '../src/paginate.ts'
import type { CloudflareEnvelope } from '../src/types.ts'

function page<T>(
  result: readonly T[],
  info?: CloudflareEnvelope['result_info'],
): CloudflareEnvelope<readonly T[]> {
  return info === undefined
    ? { success: true, errors: [], result }
    : { success: true, errors: [], result, result_info: info }
}

/** A cursor stepper for the walk tests: the walk is under test here, not any production stepper. */
const byCursor = (envelope: Pick<CloudflareEnvelope, 'result_info'>): NextPageQuery => {
  const cursor = envelope.result_info?.cursor
  return cursor === undefined || cursor === '' ? null : { cursor }
}

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
    expect(nextPageQuery({ result_info: { page: 1, per_page: 20, total_count: 50, count: 7 } }, 7)).toBeNull()
  })

  it('continues while a full page comes back', () => {
    expect(nextPageQuery({ result_info: { page: 1, per_page: 20, total_count: 50, count: 20 } }, 20)).toEqual(
      { page: 2, per_page: 20 },
    )
  })

  it('stops on a non-positive page size rather than looping forever', () => {
    expect(nextPageQuery({ result_info: { page: 1, per_page: 0, total_count: 50 } }, 0)).toBeNull()
  })
})

describe('paginate', () => {
  it('collects items from a single page', async () => {
    const fetchPage = vi.fn(async () => page(['a', 'b']))
    await expect(paginate(fetchPage, () => null, 10)).resolves.toEqual({
      items: ['a', 'b'],
      pages: 1,
      truncated: false,
    })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('follows the cursor across pages', async () => {
    const pages = [page(['a'], { cursor: 'c1' }), page(['b'], { cursor: '' })]
    let i = 0
    const fetchPage = vi.fn(async () => pages[i++]!)
    await expect(paginate(fetchPage, byCursor, 10)).resolves.toMatchObject({ items: ['a', 'b'] })
    expect(fetchPage).toHaveBeenNthCalledWith(2, { cursor: 'c1' })
  })

  it('starts from an empty overlay, letting the spec carry the first page', async () => {
    const fetchPage = vi.fn(async () => page<string>([]))
    await paginate(fetchPage, () => null, 5)
    expect(fetchPage).toHaveBeenCalledWith({})
  })

  it('reports truncation when the ceiling stops a walk the server would continue', async () => {
    const fetchPage = vi.fn(async () => page(['x'], { cursor: 'always' }))
    await expect(paginate(fetchPage, byCursor, 3)).resolves.toEqual({
      items: ['x', 'x', 'x'],
      pages: 3,
      truncated: true,
    })
  })

  it('reports no truncation when the data simply ran out', async () => {
    const pages = [page(['a'], { cursor: 'c1' }), page(['b'], { cursor: '' })]
    let i = 0
    await expect(paginate(async () => pages[i++]!, byCursor, 10)).resolves.toEqual({
      items: ['a', 'b'],
      pages: 2,
      truncated: false,
    })
  })

  it('reports no truncation when the ceiling and the end coincide', async () => {
    // `pages === maxPages` alone is not truncation: the walk has to have been
    // offered a further page for the result to be partial.
    const pages = [page(['a'], { cursor: 'c1' }), page(['b'], { cursor: '' })]
    let i = 0
    await expect(paginate(async () => pages[i++]!, byCursor, 2)).resolves.toMatchObject({
      pages: 2,
      truncated: false,
    })
  })

  it('reports the running count to the stepper', async () => {
    const seen: number[] = []
    const pages = [page(['a', 'b'], { cursor: 'c' }), page(['c'], { cursor: '' })]
    let i = 0
    const stepper = (env: CloudflareEnvelope<readonly unknown[]>, count: number) => {
      seen.push(count)
      return byCursor(env)
    }
    await paginate(async () => pages[i++]!, stepper, 10)
    expect(seen).toEqual([2, 3])
  })

  it('collects nothing from an empty first page', async () => {
    await expect(
      paginate(
        async () => page([]),
        () => null,
        5,
      ),
    ).resolves.toMatchObject({ items: [] })
  })
})

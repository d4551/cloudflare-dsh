/**
 * Cursor and page walking over Cloudflare list endpoints.
 *
 * Cloudflare uses two pagination styles. Both are reduced here to "given the
 * last envelope, what query goes on the next request, if any" — a pure step
 * function the async generator drives.
 */
import type { CloudflareEnvelope, QueryValue } from './types.ts'

/** The query overlay for the next page, or null when the walk is complete. */
export type NextPageQuery = Readonly<Record<string, QueryValue>> | null

/**
 * Next step for a page-numbered endpoint.
 *
 * Stops when the accumulated count reaches `total_count`, or when the page came
 * back short, whichever happens first.
 */
export function nextPageQuery(
  envelope: Pick<CloudflareEnvelope, 'result_info'>,
  seen: number,
): NextPageQuery {
  const info = envelope.result_info
  if (info === undefined) return null
  const { page, per_page: perPage, total_count: totalCount, count } = info
  if (page === undefined || perPage === undefined || totalCount === undefined) return null
  if (seen >= totalCount) return null
  if (perPage <= 0) return null
  // A short page means the server has nothing more to give, whatever its
  // total_count says. Without this the walk keeps asking for pages that come
  // back empty until the advertised total is reached. An absent count says
  // nothing about the page length, so it must not read as short.
  const returned = count ?? Number.POSITIVE_INFINITY
  if (returned < perPage) return null
  return { page: page + 1, per_page: perPage }
}

/** Fetches one page given a query overlay. */
export type PageFetcher<T> = (
  query: Readonly<Record<string, QueryValue>>,
) => Promise<CloudflareEnvelope<readonly T[]>>

/** Everything one walk produced. */
export interface PageWalk<T> {
  /** Items from every page, in order. */
  readonly items: T[]
  /** Pages actually fetched. */
  readonly pages: number
  /** True when the page ceiling stopped the walk before the data ran out. */
  readonly truncated: boolean
}

/** Chooses the next overlay from the envelope just received. */
export type PageStepper = (envelope: CloudflareEnvelope<readonly unknown[]>, seen: number) => NextPageQuery

/**
 * Walk every page, yielding items one at a time.
 *
 * `maxPages` is a hard stop so a server that keeps returning the same cursor
 * cannot spin forever.
 */
export async function paginate<T>(
  fetchPage: PageFetcher<T>,
  step: PageStepper,
  maxPages: number,
): Promise<PageWalk<T>> {
  let query: NextPageQuery = {}
  let seen = 0
  let page = 0
  const items: T[] = []

  // The walk is expressed as an async iterator rather than an awaiting loop so
  // that each request is one `await` in one call, and the loop below stays
  // flat: page depth costs nothing, however many pages a walk covers.
  const pages: AsyncIterable<CloudflareEnvelope<readonly T[]>> = {
    [Symbol.asyncIterator]: () => ({
      async next(): Promise<IteratorResult<CloudflareEnvelope<readonly T[]>, undefined>> {
        const current = query
        if (page >= maxPages || current === null) return { done: true, value: undefined }
        page += 1
        return { done: false, value: await fetchPage(current) }
      },
    }),
  }

  for await (const envelope of pages) {
    for (const item of envelope.result) {
      seen += 1
      items.push(item)
    }
    query = step(envelope, seen)
  }

  // Stopping at the ceiling with a next page still offered is a different
  // outcome from running out of data. A caller that cannot tell them apart
  // reports a partial result as a total. The walk only ever stops while a
  // next page is still offered because the ceiling was reached, so that alone
  // is the signal — a `page >= maxPages` conjunct here would be dead, and a
  // mutation testing run proved it so.
  return { items, pages: page, truncated: query !== null }
}

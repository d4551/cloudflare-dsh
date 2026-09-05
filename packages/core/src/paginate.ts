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

/** Next step for a cursor-paginated endpoint (KV keys, Vectorize, AI Gateway logs). */
export function nextCursorQuery(envelope: Pick<CloudflareEnvelope, 'result_info'>): NextPageQuery {
  const cursor = envelope.result_info?.cursor
  if (cursor === undefined || cursor === '') return null
  return { cursor }
}

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
  const { page, per_page: perPage, total_count: totalCount } = info
  if (page === undefined || perPage === undefined || totalCount === undefined) return null
  if (seen >= totalCount) return null
  if (perPage <= 0) return null
  return { page: page + 1, per_page: perPage }
}

/** Fetches one page given a query overlay. */
export type PageFetcher<T> = (query: Readonly<Record<string, QueryValue>>) => Promise<CloudflareEnvelope<readonly T[]>>

/** Chooses the next overlay from the envelope just received. */
export type PageStepper = (envelope: CloudflareEnvelope<readonly unknown[]>, seen: number) => NextPageQuery

/**
 * Walk every page, yielding items one at a time.
 *
 * `maxPages` is a hard stop so a server that keeps returning the same cursor
 * cannot spin forever.
 */
export async function* paginate<T>(
  fetchPage: PageFetcher<T>,
  step: PageStepper,
  maxPages: number,
  initialQuery: Readonly<Record<string, QueryValue>> = {},
): AsyncGenerator<T, void, undefined> {
  let query: NextPageQuery = initialQuery
  let seen = 0
  let page = 0

  // The walk is expressed as an async iterator rather than an awaiting loop so
  // that each request is one `await` in one call, and the outer `for await`
  // stays flat: page depth costs nothing, however many pages a walk covers.
  // `query` is shared with the loop below, which is what lets the stepper see
  // the running count *after* a page's items have been yielded.
  const pages: AsyncIterable<CloudflareEnvelope<readonly T[]>> = {
    [Symbol.asyncIterator]: () => ({
      async next() {
        const current = query
        if (page >= maxPages || current === null) return { done: true as const, value: undefined }
        page += 1
        return { done: false as const, value: await fetchPage(current) }
      },
    }),
  }

  for await (const envelope of pages) {
    for (const item of envelope.result) {
      seen += 1
      yield item
    }
    query = step(envelope, seen)
  }
}

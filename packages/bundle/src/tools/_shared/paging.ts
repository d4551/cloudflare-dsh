/**
 * Paging state for the list tools.
 *
 * Cloudflare pages its list endpoints three ways. Page-numbered endpoints take
 * `page` and `per_page`; some of them (KV namespaces, D1 databases) answer with
 * a `result_info.total_count`, others (the model catalogue, AI gateways) answer
 * with nothing, so completeness is certain in the first case and inferred from
 * a short page in the second — and the outcome says which, by carrying the
 * total or `null`. Cursor endpoints (KV keys, R2 buckets) hand back a cursor
 * that is absent or empty on the last page. The queue listing takes no paging
 * parameters at all.
 */
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { isInteger } from './json.ts'

/**
 * `result_info` as it actually arrives. The core client declares it as
 * `CloudflareResultInfo`, but that is a claim about the wire rather than a
 * guarantee from it, and these helpers exist to check the claim — so they take
 * the fields as `unknown` and every `CloudflareResultInfo` is admissible.
 */
interface WireResultInfo {
  readonly cursor?: unknown
  readonly total_count?: unknown
}

/** Keep the literal types of a property spec, as `defineTool` does for the schemas it is handed. */
function properties<T extends ParameterSchemaSpec>(spec: T): T {
  return spec
}

/** Output properties every page-numbered listing carries beside its items. */
export const PAGE_OUTCOME_PROPERTIES = properties({
  page: { type: 'integer', required: true, description: 'The page this is.' },
  perPage: { type: 'integer', required: true, description: 'Items requested per page.' },
  total: {
    oneOf: [{ type: 'integer' }, { type: 'null' }],
    required: true,
    description: 'Items the API says exist in all; null when it did not say.',
  },
  complete: {
    type: 'boolean',
    required: true,
    description:
      'Whether this page is the last: certain when the total is known, inferred from a short page otherwise.',
  },
})

/** What one page of a page-numbered listing reports about the whole. */
interface PageOutcome {
  readonly page: number
  readonly perPage: number
  /** Items the API says exist in all, or null when it did not say. */
  readonly total: number | null
  /** Whether this page is the last: certain when the total is known, inferred from a short page otherwise. */
  readonly complete: boolean
}

/** What a listing without paging parameters reports about the whole. */
interface WholeListOutcome {
  readonly total: number | null
  readonly complete: boolean
}

/** What a cursor-paged listing reports about the next page. */
interface CursorOutcome {
  /** Cursor for the next page; empty when complete. */
  readonly cursor: string
  readonly complete: boolean
}

/** Raised when a call asks for a page before the first. */
export class PageNumberError extends RangeError {
  override readonly name = 'PageNumberError'
  constructor(page: number) {
    super(`page must be 1 or more, got ${page}`)
  }
}

/** Raised when `result_info` carries a paging field of the wrong type. */
export class ResultInfoShapeError extends TypeError {
  override readonly name = 'ResultInfoShapeError'
  constructor(field: string, value: unknown) {
    super(
      `result_info.${field} must be ${field === 'cursor' ? 'a string' : 'an integer'}, got ${typeof value}`,
    )
  }
}

/** The page a call asked for: the first when it did not say, and never before it. */
export function requestedPage(page: number | undefined): number {
  if (page === undefined) return 1
  if (page < 1) throw new PageNumberError(page)
  return page
}

/** The total the API reported, or null when it reported none. */
function reportedTotal(info: WireResultInfo | undefined): number | null {
  const total = info?.total_count
  if (total === undefined) return null
  if (!isInteger(total)) throw new ResultInfoShapeError('total_count', total)
  return total
}

/** Project one page's `result_info` into what the caller can rely on. */
export function pageOutcome(
  info: WireResultInfo | undefined,
  page: number,
  perPage: number,
  returned: number,
): PageOutcome {
  const total = reportedTotal(info)
  if (total === null) return { page, perPage, total, complete: returned < perPage }
  return { page, perPage, total, complete: page * perPage >= total }
}

/**
 * Project the `result_info` of a listing that cannot be paged. The API may
 * still report a total larger than what it returned; the caller is told so
 * rather than shown a partial list as the whole.
 */
export function wholeListOutcome(info: WireResultInfo | undefined, returned: number): WholeListOutcome {
  const total = reportedTotal(info)
  // Compared against what came back when the API reported no total, because a
  // listing with no next page cannot be short of one. Guarding the comparison
  // with `total !== null` reads as the careful spelling and is unobservable:
  // `returned < null` is `returned < 0`, false for every count, so the guard
  // decides nothing while implying that it does.
  const claimed = total ?? returned
  return { total, complete: returned >= claimed }
}

/** Project a cursor-paged `result_info`: the API ends a listing by omitting the cursor or sending an empty one. */
export function cursorOutcome(info: WireResultInfo | undefined): CursorOutcome {
  const raw = info?.cursor
  if (raw !== undefined && typeof raw !== 'string') throw new ResultInfoShapeError('cursor', raw)
  const cursor = raw === undefined ? '' : raw
  return { cursor, complete: cursor === '' }
}

/** The page context for a listing's count line. */
export function pageNote(outcome: PageOutcome): string {
  if (outcome.total !== null) {
    return `page ${outcome.page} of ${Math.max(1, Math.ceil(outcome.total / outcome.perPage))}`
  }
  return outcome.complete ? `page ${outcome.page}, the last` : `page ${outcome.page}, more may follow`
}

/** The note for a listing without paging, when the API reported more than it returned. */
export function wholeListNote(outcome: WholeListOutcome): string | undefined {
  return outcome.complete ? undefined : `the API reports ${outcome.total} in all`
}

/** The note for a cursor-paged listing. */
export function cursorNote(outcome: CursorOutcome): string | undefined {
  return outcome.complete ? undefined : 'more follow the cursor'
}

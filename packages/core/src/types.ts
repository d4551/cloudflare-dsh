/** Shared wire and domain types for the Cloudflare seam. */

/** One error entry inside a Cloudflare response envelope. */
export interface CloudflareErrorEntry {
  readonly code: number
  readonly message: string
}

/** Pagination metadata returned by list endpoints. */
export interface CloudflareResultInfo {
  readonly page?: number
  readonly per_page?: number
  readonly count?: number
  readonly total_count?: number
  readonly cursor?: string
}

/**
 * The canonical Cloudflare response envelope.
 *
 * Every `api.cloudflare.com/client/v4` response uses this shape, including
 * errors, which is why normalization is a single pure function over it.
 */
export interface CloudflareEnvelope<T = unknown> {
  readonly success: boolean
  readonly errors: readonly CloudflareErrorEntry[]
  readonly result: T
  readonly result_info?: CloudflareResultInfo
}

/** The account whose resources a request addresses. */
export interface Scope {
  readonly id: string
}

/** HTTP verbs the seam is willing to issue. */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Query parameter values accepted by the request builder. */
export type QueryValue = string | number | boolean | readonly (string | number | boolean)[]

/**
 * One query parameter in a positional list.
 *
 * A record cannot express interleaved repeats: Cloudflare's own SDKs serialize
 * an array of filter objects as `filters.key=…&filters.operator=…&filters.value=…`
 * repeated per clause, and grouping by key would reorder those bytes.
 */
export type QueryPair = readonly [key: string, value: string | number | boolean]

/** A description of one Cloudflare REST call, before dispatch. */
export interface RequestSpec {
  readonly method: HttpMethod
  /** Path under `/client/v4`, with a leading slash. */
  readonly path: string
  readonly query?: Readonly<Record<string, QueryValue | undefined>>
  /** Parameters whose order and repetition are significant; appended after `query`. */
  readonly orderedQuery?: readonly QueryPair[]
  readonly body?: unknown
  /**
   * A body already encoded by the caller, sent verbatim under its own media
   * type. Vectorize's upsert takes NDJSON, which is not one JSON document, so
   * the client cannot produce it by serializing `body`. When this is set,
   * `body` is not sent.
   */
  readonly encodedBody?: { readonly contentType: string; readonly text: string } | undefined
  /**
   * Media type the caller can read, sent as the `accept` header;
   * `application/json` when absent. Only a request read as bytes names another.
   */
  readonly accept?: string | undefined
  /** Caller cancellation, fused with the client's own request timeout. */
  readonly signal?: AbortSignal | undefined
  /**
   * Budget for one attempt of this request, replacing the client default. A
   * tool that has declared a longer cooperative budget passes it here, so the
   * HTTP deadline matches the budget instead of cutting it short.
   */
  readonly timeoutMs?: number | undefined
}

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
  readonly messages: readonly CloudflareErrorEntry[]
  readonly result: T
  readonly result_info?: CloudflareResultInfo
}

/** Which scope root a resource path hangs off. */
export type ScopeKind = 'account' | 'zone'

/** A resolved scope: the kind plus its identifier. */
export interface Scope {
  readonly kind: ScopeKind
  readonly id: string
}

/** HTTP verbs the seam is willing to issue. */
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Query parameter values accepted by the request builder. */
export type QueryValue = string | number | boolean | readonly (string | number | boolean)[]

/** A description of one Cloudflare REST call, before dispatch. */
export interface RequestSpec {
  readonly method: HttpMethod
  /** Path under `/client/v4`, with a leading slash. */
  readonly path: string
  readonly query?: Readonly<Record<string, QueryValue | undefined>>
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

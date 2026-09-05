/**
 * Pure request construction.
 *
 * Nothing here performs I/O: every function maps inputs to a `Request` or a
 * string, so path building, query serialization and header assembly are all
 * unit-testable and mutation-visible.
 */
import type { HttpMethod, QueryValue, RequestSpec } from './types.ts'

/** Default Cloudflare REST base. Overridable per service instance. */
export const DEFAULT_BASE_URL = 'https://api.cloudflare.com/client/v4'

/** Methods that carry no request body. */
const BODYLESS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'HEAD'])

/** True when the method must not carry a body. */
export function isBodyless(method: HttpMethod): boolean {
  return BODYLESS.has(method)
}

/**
 * Serialize query parameters.
 *
 * `undefined` values are dropped; arrays repeat the key; booleans and numbers
 * stringify. Returns `''` when nothing survives, so callers can concatenate
 * unconditionally.
 */
export function buildQueryString(
  query: Readonly<Record<string, QueryValue | undefined>> | undefined,
): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const key of Object.keys(query)) {
    const value = query[key]
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
      continue
    }
    params.append(key, String(value as string | number | boolean))
  }
  const serialized = params.toString()
  return serialized === '' ? '' : `?${serialized}`
}

/**
 * Reject a path that could escape the intended host or API root.
 *
 * This is the containment boundary for the generic `cloudflare_api` tool: it
 * must not be able to reach the R2 S3 host, the Turnstile host, or any absolute
 * URL. Returns the path unchanged when safe.
 */
export function assertSafePath(path: string): string {
  if (!path.startsWith('/')) {
    throw new TypeError(`path must start with "/", got ${JSON.stringify(path)}`)
  }
  if (path.startsWith('//')) {
    throw new TypeError('path must not begin with "//" (protocol-relative URL)')
  }
  if (path.includes('..')) {
    throw new TypeError('path must not contain ".."')
  }
  return path
}

/** Compose the absolute URL for a request spec. */
export function buildUrl(baseUrl: string, spec: Pick<RequestSpec, 'path' | 'query'>): string {
  const path = assertSafePath(spec.path)
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${base}${path}${buildQueryString(spec.query)}`
}

/** Header assembly inputs. */
export interface HeaderInput {
  readonly token: string
  readonly hasBody: boolean
  readonly extra?: Readonly<Record<string, string>> | undefined
}

/**
 * Assemble request headers.
 *
 * The bearer token is applied last so a caller-supplied `authorization` header
 * can never displace the resolved credential.
 */
export function buildHeaders(input: HeaderInput): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(input.extra ?? {})) {
    headers.set(key, value)
  }
  headers.set('accept', 'application/json')
  if (input.hasBody) headers.set('content-type', 'application/json')
  headers.set('authorization', `Bearer ${input.token}`)
  return headers
}

/** Everything needed to turn a spec into a `Request`. */
export interface BuildRequestInput {
  readonly baseUrl: string
  readonly spec: RequestSpec
  readonly token: string
}

/**
 * Build the `Request` for one Cloudflare call.
 *
 * A body on a bodyless method is dropped rather than rejected, matching what
 * `fetch` itself would do, but the content-type header is dropped with it.
 */
export function buildRequest(input: BuildRequestInput): Request {
  const { spec } = input
  const url = buildUrl(input.baseUrl, spec)
  const sendsBody = !isBodyless(spec.method) && spec.body !== undefined
  const headers = buildHeaders({
    token: input.token,
    hasBody: sendsBody,
    extra: spec.headers,
  })
  const init: RequestInit = { method: spec.method, headers }
  if (sendsBody) init.body = JSON.stringify(spec.body)
  return new Request(url, init)
}

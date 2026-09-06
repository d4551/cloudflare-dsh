/**
 * Pure request construction.
 *
 * Nothing here performs I/O: every function maps inputs to a `Request` or a
 * string, so path building, query serialization and header assembly are all
 * unit-testable and mutation-visible.
 */
import type { HttpMethod, QueryPair, QueryValue, RequestSpec } from './types.ts'

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
  ordered?: readonly QueryPair[],
): string {
  const params = new URLSearchParams()
  const record = query ?? {}
  for (const key of Object.keys(record)) {
    const value = record[key]
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item))
      continue
    }
    params.append(key, String(value as string | number | boolean))
  }
  // Appended in the order given: repeats here are positional, so grouping them
  // by key would change what the server reads.
  for (const [key, value] of ordered ?? []) params.append(key, String(value))
  const serialized = params.toString()
  return serialized === '' ? '' : `?${serialized}`
}

/**
 * Bound on percent-decoding rounds.
 *
 * A security invariant rather than a tunable: making it configurable would let
 * configuration decide how hard the containment boundary tries.
 */
const MAX_DECODE_ROUNDS = 4

/**
 * Fully percent-decode a path.
 *
 * Decoding repeats to a fixed point because one pass is not enough: `%2574`
 * becomes `%74`, which a server decoding again resolves to `t`. A malformed
 * escape is a rejection, never a value that passes through unchecked.
 */
export function decodePath(path: string): string {
  let current = path
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string
    try {
      next = decodeURIComponent(current)
    } catch {
      throw new TypeError(`path contains a malformed percent-escape: ${JSON.stringify(path)}`)
    }
    if (next === current) return current
    current = next
  }
  throw new TypeError(`path is encoded beyond the depth this can validate: ${JSON.stringify(path)}`)
}

/** The structural rules, applied to one spelling of a path. */
function assertPathShape(path: string, label: string): void {
  if (!path.startsWith('/')) {
    throw new TypeError(`${label} must start with "/", got ${JSON.stringify(path)}`)
  }
  if (path.startsWith('//')) {
    throw new TypeError(`${label} must not begin with "//" (protocol-relative URL)`)
  }
  if (path.includes('..')) {
    throw new TypeError(`${label} must not contain ".."`)
  }
}

/**
 * Reject a path that could escape the intended host or API root.
 *
 * This is the containment boundary for the generic `cloudflare_api` tool: it
 * must not be able to reach the R2 S3 host, the Turnstile host, or any absolute
 * URL. Returns the path unchanged when safe.
 *
 * The rules are applied to the decoded spelling as well as the literal one,
 * because the server decodes before it routes: `/x/%2e%2e/y` reaches exactly
 * the resource `/x/../y` names, so checking only the literal text would let an
 * encoded traversal through.
 */
export function assertSafePath(path: string): string {
  assertPathShape(path, 'path')
  assertPathShape(decodePath(path), 'decoded path')
  return path
}

/** Scheme the Cloudflare REST API is served over. */
const REQUIRED_PROTOCOL = 'https:'

/**
 * Validate the configured REST root.
 *
 * `assertSafePath` contains the path, but containment only means anything
 * relative to a known origin: a `baseUrl` naming a different host moves every
 * request there, bearer token included. Parsed rather than pattern-matched, and
 * checked at construction, so a bad value fails at load instead of at the first
 * call.
 */
export function assertSafeBaseUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError(`baseUrl must be an absolute URL, got ${JSON.stringify(baseUrl)}`)
  }
  if (url.protocol !== REQUIRED_PROTOCOL) {
    throw new TypeError(`baseUrl must use ${REQUIRED_PROTOCOL}, got ${JSON.stringify(url.protocol)}`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('baseUrl must not embed credentials')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new TypeError('baseUrl must not carry a query string or fragment')
  }
  return baseUrl
}

/** Compose the absolute URL for a request spec. */
export function buildUrl(
  baseUrl: string,
  spec: Pick<RequestSpec, 'path' | 'query' | 'orderedQuery'>,
): string {
  const path = assertSafePath(spec.path)
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${base}${path}${buildQueryString(spec.query, spec.orderedQuery)}`
}

/** Header assembly inputs. */
export interface HeaderInput {
  readonly token: string
  readonly hasBody: boolean
  /** The media type the caller can read. */
  readonly accept: string
}

/**
 * Assemble request headers.
 *
 * Only the client sets headers: the accepted type, a content type when a body
 * is sent, and the bearer token.
 */
export function buildHeaders(input: HeaderInput): Headers {
  const headers = new Headers()
  headers.set('accept', input.accept)
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
    accept: spec.accept === undefined ? 'application/json' : spec.accept,
  })
  const init: RequestInit = { method: spec.method, headers }
  if (sendsBody) init.body = JSON.stringify(spec.body)
  return new Request(url, init)
}

/**
 * Pure helpers for the account and generic-API tools.
 */
import { assertSafePath, decodePath } from '@d4551/dsh-cloudflare-core/request'
import type { HttpMethod, JsonValue, QueryValue, RequestSpec } from '@d4551/dsh-cloudflare-core/types'

/** Raised when the generic API tool is asked to do something it may not. */
export class CloudflareApiDeniedError extends Error {
  override readonly name = 'CloudflareApiDeniedError'
}

/**
 * Validate a generic API call before it is issued.
 *
 * The path is checked against the API root and, for each configured denylist
 * prefix, against both the literal and the decoded spelling — the server
 * decodes before routing, so the denylist has to see what the server will
 * see. The tool's parameter schema offers only the methods its plugin
 * permits, so no other method arrives here.
 *
 * @returns the validated request spec.
 */
export function buildGenericSpec(
  method: HttpMethod,
  path: string,
  query: Readonly<Record<string, QueryValue>> | undefined,
  body: JsonValue | undefined,
  options: { readonly denyPathPrefixes: readonly string[] },
): RequestSpec {
  const safe = assertSafePath(path)
  const decoded = decodePath(safe)
  for (const prefix of options.denyPathPrefixes) {
    if (safe.startsWith(prefix) || decoded.startsWith(prefix)) {
      throw new CloudflareApiDeniedError(`path ${safe} is blocked by the configured denylist (${prefix})`)
    }
  }
  return {
    method,
    path: safe,
    ...(query === undefined ? {} : { query }),
    ...(body === undefined ? {} : { body }),
  }
}

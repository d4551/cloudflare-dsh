/**
 * Pure helpers for the account and generic-API tools.
 */
import {
  assertSafePath,
  decodePath,
  type HttpMethod,
  type QueryValue,
  type RequestSpec,
} from '@d4551/dsh-cloudflare-core'

/** Raised when the generic API tool is asked to do something it may not. */
export class CloudflareApiDeniedError extends Error {
  override readonly name = 'CloudflareApiDeniedError'
}

/**
 * Validate a generic API call before it is issued.
 *
 * Two things are enforced: the path cannot escape the API root, and any
 * configured denylist prefix wins outright. Which methods the tool offers at
 * all is decided by its parameter schema, so a method the plugin does not
 * permit never reaches this function.
 *
 * @returns the validated request spec.
 */
export function buildGenericSpec(
  method: HttpMethod,
  path: string,
  query: Readonly<Record<string, QueryValue>> | undefined,
  body: unknown,
  options: { readonly denyPathPrefixes: readonly string[] },
): RequestSpec {
  const safe = assertSafePath(path)

  // Compared against the decoded spelling as well as the literal one. The
  // server decodes before routing, so `/accounts/x/%74okens` reaches the same
  // resource as `/accounts/x/tokens` while failing a raw prefix comparison —
  // the denylist has to see what the server will see.
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

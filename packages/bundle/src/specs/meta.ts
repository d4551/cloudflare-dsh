/**
 * Pure helpers for the account and generic-API tools.
 */
import type { HttpMethod, JsonValue, QueryValue, RequestSpec } from '@d4551/dsh-cloudflare-core/types'

/** Raised when the generic API tool is asked to do something it may not. */
export class CloudflareApiDeniedError extends Error {
  override readonly name = 'CloudflareApiDeniedError'
}

/**
 * Assemble the validated generic API call into its request spec.
 *
 * The path arrives already contained to the API root and paired with its
 * decoded spelling — the seam's `safeApiPath` produces both — so the denylist
 * here compares the spelling the server will see against the one that was
 * written, and no other validation happens on this side of the seam.
 *
 * @returns the request spec.
 */
export function buildGenericSpec(
  method: HttpMethod,
  paths: { readonly safe: string; readonly decoded: string },
  query: Readonly<Record<string, QueryValue>> | undefined,
  body: JsonValue | undefined,
  options: { readonly denyPathPrefixes: readonly string[] },
): RequestSpec {
  for (const prefix of options.denyPathPrefixes) {
    if (paths.safe.startsWith(prefix) || paths.decoded.startsWith(prefix)) {
      throw new CloudflareApiDeniedError(
        `path ${paths.safe} is blocked by the configured denylist (${prefix})`,
      )
    }
  }
  return {
    method,
    path: paths.safe,
    ...(query === undefined ? {} : { query }),
    ...(body === undefined ? {} : { body }),
  }
}

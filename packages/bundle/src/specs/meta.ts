/**
 * Pure helpers for the account and generic-API tools.
 */
import { assertSafePath, decodePath, type HttpMethod, type RequestSpec } from '@d4551/dsh-cloudflare-core'

/** Methods that only read. The generic tool is limited to these by default. */
const READ_ONLY: ReadonlySet<HttpMethod> = new Set<HttpMethod>(['GET', 'HEAD'])

/** True when the method cannot change server state. */
export function isReadOnlyMethod(method: HttpMethod): boolean {
  return READ_ONLY.has(method)
}

/** Raised when the generic API tool is asked to do something it may not. */
export class CloudflareApiDeniedError extends Error {
  override readonly name = 'CloudflareApiDeniedError'
}

/**
 * Validate a generic API call before it is issued.
 *
 * Three things are enforced: the path cannot escape the API root, mutations
 * require explicit opt-in, and any configured denylist prefix wins outright.
 *
 * @returns the validated request spec.
 */
export function buildGenericSpec(
  method: HttpMethod,
  path: string,
  query: Readonly<Record<string, string>> | undefined,
  body: unknown,
  options: { readonly allowMutations: boolean; readonly denyPathPrefixes: readonly string[] },
): RequestSpec {
  const safe = assertSafePath(path)

  if (!isReadOnlyMethod(method) && !options.allowMutations) {
    throw new CloudflareApiDeniedError(
      `${method} is a mutating request and this plugin is configured read-only. ` +
        'Set `allowMutations: true` on the cloudflare-tools-meta plugin to permit it.',
    )
  }
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

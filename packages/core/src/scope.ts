/**
 * Account scoping for request paths.
 *
 * Every Cloudflare resource this bundle wraps hangs off an account, so the scope
 * is the account and nothing else. A scope-relative path becomes absolute by
 * prefixing it, with the identifier percent-encoded.
 */
import type { Scope } from './types.ts'

/** Build the account scope, refusing an empty id so misconfiguration fails loud. */
export function makeScope(id: string): Scope {
  if (id === '') throw new TypeError('Cloudflare account id must not be empty')
  return { id }
}

/** Prefix a scope-relative path with the account root. */
export function scopedPath(scope: Scope, relative: string): string {
  if (!relative.startsWith('/')) {
    throw new TypeError(`scope-relative path must start with "/", got ${JSON.stringify(relative)}`)
  }
  return `/accounts/${encodeURIComponent(scope.id)}${relative}`
}

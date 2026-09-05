/**
 * The `{accounts_or_zones}` abstraction.
 *
 * Many Cloudflare endpoints accept either `/accounts/{id}/...` or
 * `/zones/{id}/...`. Rather than duplicate every call site, a resource path is
 * written scope-relative and prefixed here.
 */
import type { Scope, ScopeKind } from './types.ts'

/** URL segment for each scope kind. */
export function scopeSegment(kind: ScopeKind): string {
  return kind === 'account' ? 'accounts' : 'zones'
}

/** Build a scope, rejecting an empty identifier so misconfiguration fails loud. */
export function makeScope(kind: ScopeKind, id: string): Scope {
  if (id === '') throw new TypeError(`Cloudflare ${kind} id must not be empty`)
  return { kind, id }
}

/**
 * Prefix a scope-relative path with its scope root.
 *
 * @param scope - the resolved account or zone.
 * @param relative - path below the scope, with a leading slash (e.g. `/d1/database`).
 */
export function scopedPath(scope: Scope, relative: string): string {
  if (!relative.startsWith('/')) {
    throw new TypeError(`scope-relative path must start with "/", got ${JSON.stringify(relative)}`)
  }
  return `/${scopeSegment(scope.kind)}/${encodeURIComponent(scope.id)}${relative}`
}

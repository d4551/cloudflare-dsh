/**
 * Credential resolution.
 *
 * DSH's credentials subsystem is explicit that consumers "re-resolve at each
 * operation and must not cache across operations", so rotation takes effect
 * without a restart. Everything here therefore resolves per call.
 *
 * Only the structural shape we actually use is declared, so this package
 * depends on Cordis alone rather than the whole harness package graph.
 */
import { CloudflareAuthError } from './errors.ts'

/** The slice of `ctx.credentials` this seam consumes. */
export interface CredentialResolver {
  /** Resolve a reference to its secret value, or undefined when unset. */
  resolve(ref: string): Promise<string | undefined> | string | undefined
}

/**
 * Resolve a credential, failing loud when it is missing.
 *
 * The thrown error names the *reference* (a POSIX environment-variable name),
 * never the value, so it is safe to log or render.
 */
export async function requireCredential(credentials: CredentialResolver, ref: string): Promise<string> {
  const value = await credentials.resolve(ref)
  if (value === undefined || value === '') {
    throw new CloudflareAuthError(
      ref,
      `Cloudflare credential ${ref} is not set. Store it with the credentials service or export ${ref}.`,
      401,
    )
  }
  return value
}

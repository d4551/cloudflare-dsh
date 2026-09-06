/**
 * Pure formatting for the client surfaces.
 *
 * Kept out of the components so number and percentage handling can be tested
 * directly, and so the components stay declarative.
 */

/** A session's gateway usage, as `cloudflare_aigateway_session_cost` returns it. */
export interface SessionUsage {
  readonly requests: number
  readonly cost: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cached: number
}

/**
 * Format a cost in USD.
 *
 * Gateway costs are frequently fractions of a cent, so small amounts keep more
 * precision rather than rounding away to `$0.00` and looking free.
 */
export function formatCost(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  if (amount === 0) return '$0.00'
  if (Math.abs(amount) < 0.01) return `$${amount.toFixed(5)}`
  return `$${amount.toFixed(2)}`
}

/** Format a cache hit rate, or an em dash when there is nothing to divide by. */
export function formatCacheRate(usage: Pick<SessionUsage, 'requests' | 'cached'>): string {
  if (usage.requests <= 0) return '—'
  return `${Math.round((usage.cached / usage.requests) * 100)}%`
}

/** Whether there is anything worth showing for this session. */
export function hasUsage(usage: SessionUsage | undefined): usage is SessionUsage {
  return usage !== undefined && usage.requests > 0
}

/** Environment-variable naming rule for a credential reference. */
const CREDENTIAL_REF = /^[A-Z][A-Z0-9_]*$/

/**
 * Validate a credential reference.
 *
 * A reference is a POSIX environment-variable name; rejecting anything else
 * here means the mistake surfaces in the form rather than as a failed request.
 */
export function isValidCredentialRef(value: string): boolean {
  return CREDENTIAL_REF.test(value)
}

/**
 * Retry policy.
 *
 * The decision and the delay are pure functions; only `runWithRetry` touches
 * time, and it takes its sleep and randomness as parameters so tests stay
 * deterministic without mocking globals.
 */
import { CloudflareRateLimitError, isRetryableStatus } from './errors.ts'

/** Tunables. These are Config fields on the service, never inline constants. */
export interface RetryPolicy {
  readonly maxRetries: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
}

/** Whether another attempt is permitted for this status. */
export function shouldRetry(status: number, attempt: number, policy: RetryPolicy): boolean {
  if (attempt >= policy.maxRetries) return false
  return isRetryableStatus(status)
}

/**
 * Exponential backoff with full jitter, capped at `maxDelayMs`.
 *
 * @param attempt - zero-based attempt index that just failed.
 * @param random - value in [0, 1); injected so the delay is testable.
 */
export function backoffDelayMs(attempt: number, policy: RetryPolicy, random: number): number {
  const exponential = policy.baseDelayMs * 2 ** attempt
  const capped = Math.min(exponential, policy.maxDelayMs)
  return Math.round(capped * random)
}

/**
 * Pick the wait before the next attempt.
 *
 * A server-supplied `Retry-After` wins over computed backoff, but is still
 * capped so a hostile or mistaken header cannot stall the agent indefinitely.
 */
export function nextDelayMs(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  random: number,
): number {
  if (error instanceof CloudflareRateLimitError && error.retryAfterMs !== null) {
    return Math.min(error.retryAfterMs, policy.maxDelayMs)
  }
  return backoffDelayMs(attempt, policy, random)
}

/** Collaborators for the retry loop, injected to keep it deterministic. */
export interface RetryDeps {
  readonly sleep: (ms: number) => Promise<void>
  readonly random: () => number
}

/**
 * Run `attempt` until it succeeds, is not retryable, or the budget is spent.
 *
 * `classify` reports the HTTP status behind a thrown error; returning a
 * non-retryable status stops the loop immediately.
 */
export async function runWithRetry<T>(
  attempt: (attemptIndex: number) => Promise<T>,
  statusOf: (error: unknown) => number,
  policy: RetryPolicy,
  deps: RetryDeps,
): Promise<T> {
  // `shouldRetry` is the sole authority on the budget. Bounding the loop as
  // well would duplicate that decision, and the two copies could disagree.
  for (let i = 0; ; i += 1) {
    try {
      // Attempts are sequential by definition: each one depends on the
      // previous having failed, so these awaits cannot be batched.
      // eslint-disable-next-line no-await-in-loop
      return await attempt(i)
    } catch (error) {
      if (!shouldRetry(statusOf(error), i, policy)) throw error
      // eslint-disable-next-line no-await-in-loop
      await deps.sleep(nextDelayMs(error, i, policy, deps.random()))
    }
  }
}

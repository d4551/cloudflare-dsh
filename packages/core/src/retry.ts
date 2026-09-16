/**
 * Retry policy.
 *
 * The decision and the delay are pure functions; only `runWithRetry` touches
 * time, and it takes its sleep and randomness as parameters so tests stay
 * deterministic without mocking globals.
 *
 * The one untyped channel in the package runs through here: a rejected promise
 * carries a reason JavaScript gives no type for, so the classifiers below are
 * generic over it and narrow with `instanceof` rather than claiming a shape up
 * front. Naming the reason instead would assert a set of failure types the
 * transport never promised — a stub, or a platform error, may reject with a
 * string — and a rejection that does not match rethrows unchanged.
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
 * The reason is generic because a rejection reason is: the `instanceof` check
 * is what establishes the one shape this reads, and every other reason falls
 * through to computed backoff.
 */
export function nextDelayMs<Reason>(
  error: Reason,
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
 * The loop rides the promise chain rather than a `catch` block: a rejection is
 * the failure channel this inspects, and a synchronous throw inside `attempt`
 * becomes a rejection because the call sits in a handler rather than in the
 * body. `statusOf` reports the HTTP status behind the reason; a non-retryable
 * status stops the loop immediately.
 *
 * Recursive rather than iterative, so one attempt is one link in one chain.
 * `shouldRetry` stays the sole authority on the budget: there is no second
 * bound here that could disagree with it.
 */
export function runWithRetry<T>(
  attempt: (attemptIndex: number) => Promise<T>,
  statusOf: <Reason>(error: Reason) => number,
  policy: RetryPolicy,
  deps: RetryDeps,
): Promise<T> {
  const runAttempt = (index: number): Promise<T> =>
    Promise.resolve(index)
      .then(attempt)
      .then(undefined, (reason) => {
        if (!shouldRetry(statusOf(reason), index, policy)) throw reason
        return deps.sleep(nextDelayMs(reason, index, policy, deps.random())).then(() => runAttempt(index + 1))
      })
  return runAttempt(0)
}

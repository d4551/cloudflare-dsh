/**
 * Pure normalization of Cloudflare failures into typed errors.
 *
 * Every branch here is reachable from a unit test with no I/O, which is what
 * keeps the mutation score honest on the busiest logic in the package.
 */
import type { CloudflareEnvelope, CloudflareErrorEntry } from './types.ts'

/** Cloudflare's code for an invalid or missing API token. */
export const CF_CODE_UNAUTHORIZED = 10_000

/** Base class for every failure raised by the Cloudflare seam. */
export class CloudflareError extends Error {
  override readonly name: string = 'CloudflareError'
  readonly status: number
  readonly codes: readonly number[]

  constructor(message: string, status: number, codes: readonly number[] = []) {
    super(message)
    this.status = status
    this.codes = codes
  }
}

/**
 * Authentication or authorization failure.
 *
 * Carries the *name* of the credential reference, never its value, so the
 * message is safe to surface in a session log or a UI.
 */
export class CloudflareAuthError extends CloudflareError {
  override readonly name = 'CloudflareAuthError'
  readonly credentialRef: string

  constructor(credentialRef: string, message: string, status: number, codes: readonly number[] = []) {
    super(message, status, codes)
    this.credentialRef = credentialRef
  }
}

/** Rate limited. `retryAfterMs` is null when the server sent no usable hint. */
export class CloudflareRateLimitError extends CloudflareError {
  override readonly name = 'CloudflareRateLimitError'
  readonly retryAfterMs: number | null

  constructor(message: string, retryAfterMs: number | null, codes: readonly number[] = []) {
    super(message, 429, codes)
    this.retryAfterMs = retryAfterMs
  }
}

/** The addressed resource does not exist. */
export class CloudflareNotFoundError extends CloudflareError {
  override readonly name = 'CloudflareNotFoundError'
  constructor(message: string, codes: readonly number[] = []) {
    super(message, 404, codes)
  }
}

/** Join envelope error entries into one human-readable message. */
export function formatErrorEntries(entries: readonly CloudflareErrorEntry[]): string {
  if (entries.length === 0) return 'Cloudflare request failed with no error detail'
  return entries.map((e) => `[${e.code}] ${e.message}`).join('; ')
}

/** True when the response status is worth retrying. */
export function isRetryableStatus(status: number): boolean {
  if (status === 429) return true
  return status >= 500 && status <= 599
}

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * Accepts delta-seconds; returns null for absent, malformed, or negative values
 * so the caller falls back to its own backoff policy.
 */
export function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (header === null || header === undefined) return null
  const trimmed = header.trim()
  if (trimmed === '') return null
  const seconds = Number(trimmed)
  if (!Number.isFinite(seconds)) return null
  if (seconds < 0) return null
  return Math.round(seconds * 1000)
}

/** Inputs needed to classify a failed response, with no I/O. */
export interface FailureInput {
  readonly status: number
  readonly credentialRef: string
  readonly retryAfter?: string | null
  readonly envelope?: Pick<CloudflareEnvelope, 'errors'> | undefined
}

/**
 * Map a failed Cloudflare response onto the typed error hierarchy.
 *
 * Order matters: an explicit unauthorized code wins over the status class, so a
 * `200`-shaped envelope carrying code 10000 is still an auth failure.
 */
export function classifyFailure(input: FailureInput): CloudflareError {
  const entries = input.envelope?.errors ?? []
  const codes = entries.map((e) => e.code)
  const message = formatErrorEntries(entries)

  if (codes.includes(CF_CODE_UNAUTHORIZED) || input.status === 401 || input.status === 403) {
    return new CloudflareAuthError(input.credentialRef, message, input.status, codes)
  }
  if (input.status === 429) {
    return new CloudflareRateLimitError(message, parseRetryAfterMs(input.retryAfter), codes)
  }
  if (input.status === 404) {
    return new CloudflareNotFoundError(message, codes)
  }
  return new CloudflareError(message, input.status, codes)
}

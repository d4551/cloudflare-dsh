/**
 * Provider failures to canonical harness codes.
 *
 * Pure classification, so every mapping is table-testable. The harness's own
 * `isContextWindowExceededError` / `isQuotaExceededError` predicates are used
 * rather than re-implemented, so wording that upstream already recognises keeps
 * classifying the same way here.
 */
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  EMPTY_RESPONSE_CODE,
  LlmError,
  QUOTA_EXCEEDED_CODE,
  isContextWindowExceededError,
  isQuotaExceededError,
} from '@deepseek-ai/dsh-llm'

/** Code for a request the adapter cannot express against this provider. */
export const UNSUPPORTED_OPTION_CODE = 'UNSUPPORTED_OPTION'
/** Code for a stream that went quiet for longer than the idle budget. */
export const TIMEOUT_CODE = 'TIMEOUT'
/** Code for a provider failure with no more specific classification. */
export const PROVIDER_ERROR_CODE = 'PROVIDER_ERROR'
/** Code for a rate-limited request. */
export const RATE_LIMIT_CODE = 'RATE_LIMIT'
/** Code for a completion the provider withheld under its content policy. */
export const CONTENT_FILTER_CODE = 'CONTENT_FILTER'

/** What a failed provider response tells us. */
export interface ProviderFailure {
  readonly status: number
  /** Provider code, type and message joined, as the harness predicates expect. */
  readonly detail: string
}

/**
 * Choose the canonical code for a provider failure.
 *
 * Order matters: context-window and quota wording are recognised before the
 * status class, because a provider reports both as a plain 400.
 */
export function classifyProviderCode(failure: ProviderFailure): string {
  if (isContextWindowExceededError(failure.detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
  if (isQuotaExceededError(failure.detail)) return QUOTA_EXCEEDED_CODE
  if (failure.status === 429) return RATE_LIMIT_CODE
  return PROVIDER_ERROR_CODE
}

/** Build the `LlmError` for a failed provider response. */
export function providerError(failure: ProviderFailure): LlmError {
  return new LlmError(failure.detail, classifyProviderCode(failure), { status: failure.status })
}

/** Raised when a request uses a `GenerateOptions` field this route cannot express. */
export function unsupportedOption(field: string, provider: string): LlmError {
  return new LlmError(
    `${provider} does not support the ${field} option; the harness requires adapters to reject it rather than drop it silently.`,
    UNSUPPORTED_OPTION_CODE,
  )
}

/** Raised when the provider stream goes quiet for longer than the budget. */
export function idleTimeout(ms: number): LlmError {
  return new LlmError(`provider stream produced no data for ${ms}ms`, TIMEOUT_CODE)
}

/** Raised when a completion finished normally but carried no content. */
export function emptyResponse(): LlmError {
  return new LlmError('provider returned a completion with no content blocks', EMPTY_RESPONSE_CODE)
}

/** Join provider error fields into the single string the predicates read. */
export function joinDetail(parts: readonly (string | undefined)[]): string {
  return parts.filter((p): p is string => p !== undefined && p !== '').join(' ')
}

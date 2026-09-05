/**
 * Plugin configuration.
 *
 * Every deployment-varying value is a validated Config field rather than an
 * inline constant, so it can be changed from `cordis.yml` without a code edit.
 */
import Schema from '@deepseek-ai/schemastery'

/** Validated configuration for the Cloudflare seam. */
export interface CloudflareConfig {
  /** Credential reference (a POSIX env-var name) holding the API token. */
  apiTokenRef: string
  /** Account to operate on. When empty, it is discovered at first use. */
  accountId: string
  /** REST base URL. Overridable for testing and for API-compatible proxies. */
  baseUrl: string
  /** Per-request timeout. */
  requestTimeoutMs: number
  /** Retry budget for transient failures. */
  maxRetries: number
  /** First backoff step. */
  retryBaseDelayMs: number
  /** Backoff ceiling, also the cap applied to a server `Retry-After`. */
  retryMaxDelayMs: number
  /** Hard ceiling on pages walked by a single list call. */
  maxPages: number
}

// Input is partial: a cordis.yml patch supplies only the fields it overrides
// and the schema fills the rest, so the input and output types differ.
export const CloudflareConfig: Schema<Partial<CloudflareConfig>, CloudflareConfig> = Schema.object({
  apiTokenRef: Schema.string().default('CLOUDFLARE_API_TOKEN'),
  accountId: Schema.string().default(''),
  baseUrl: Schema.string().default('https://api.cloudflare.com/client/v4'),
  requestTimeoutMs: Schema.number().default(30_000),
  maxRetries: Schema.number().default(3),
  retryBaseDelayMs: Schema.number().default(250),
  retryMaxDelayMs: Schema.number().default(10_000),
  maxPages: Schema.number().default(100),
})

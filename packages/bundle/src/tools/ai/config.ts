/**
 * Configuration for the AI tool group.
 *
 * Split from the plugin composition so the tool modules can take the typed
 * config without importing the composition that imports them.
 */
import Schema from '@deepseek-ai/schemastery'

export interface AiToolsConfig {
  /** Default page size for listing and search tools. */
  pageSize: number
  /** Default number of chunks `cloudflare_aisearch_search` returns. */
  searchMaxResults: number
  /** Default number of matches `cloudflare_vectorize_query` returns. */
  vectorTopK: number
  /** Cooperative budget for tools that wait on model inference. */
  inferenceTimeoutMs: number
}

export const Config: Schema<Partial<AiToolsConfig>, AiToolsConfig> = Schema.object({
  pageSize: Schema.natural().min(1).default(50),
  searchMaxResults: Schema.natural().min(1).default(10),
  vectorTopK: Schema.natural().min(1).default(5),
  inferenceTimeoutMs: Schema.natural().min(1).default(120_000),
})

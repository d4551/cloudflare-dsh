/**
 * Configuration for the data-plane tool group.
 *
 * Split from the plugin composition so the tool modules can take the typed
 * config without importing the composition that imports them.
 */
import Schema from '@deepseek-ai/schemastery'

export interface DataToolsConfig {
  /** Default page size for namespace, database and bucket listings. */
  pageSize: number
  /** Default number of keys `cloudflare_kv_list_keys` returns per page. */
  keyListLimit: number
  /** Characters of a KV value or a query result shown to the model before truncation. */
  renderLimit: number
  /** Default number of messages `cloudflare_queue_pull` takes. */
  queueBatchSize: number
  /** Default time pulled messages stay invisible to other consumers. */
  queueVisibilityTimeoutMs: number
}

export const Config: Schema<Partial<DataToolsConfig>, DataToolsConfig> = Schema.object({
  pageSize: Schema.natural().min(1).default(50),
  keyListLimit: Schema.natural().min(1).default(1000),
  renderLimit: Schema.natural().min(1).default(4000),
  queueBatchSize: Schema.natural().min(1).default(10),
  queueVisibilityTimeoutMs: Schema.natural().min(1).default(30_000),
})

/**
 * Pure request-spec builders for the data tools.
 *
 * Separated from tool registration so every path, query and body decision is
 * a total function that can be unit-tested and mutation-checked without a
 * network or a Cordis context.
 */
import type { RequestSpec } from '@d4551/dsh-cloudflare-core'

/** Percent-encode one path segment. */
function seg(value: string): string {
  return encodeURIComponent(value)
}

// --- Workers KV -----------------------------------------------------------

/** List the account's KV namespaces. */
export function kvNamespaceListSpec(perPage: number): RequestSpec {
  return { method: 'GET', path: '/storage/kv/namespaces', query: { per_page: perPage } }
}

/** Read one key's value. The response is raw, not an envelope. */
export function kvValuePath(namespaceId: string, key: string): string {
  return `/storage/kv/namespaces/${seg(namespaceId)}/values/${seg(key)}`
}

/** List keys in a namespace, optionally filtered by prefix. */
export function kvListKeysSpec(
  namespaceId: string,
  prefix: string | undefined,
  limit: number,
  cursor: string | undefined,
): RequestSpec {
  return {
    method: 'GET',
    path: `/storage/kv/namespaces/${seg(namespaceId)}/keys`,
    query: {
      limit,
      ...(prefix === undefined ? {} : { prefix }),
      ...(cursor === undefined ? {} : { cursor }),
    },
  }
}

/** Bulk write. Cloudflare accepts up to 10 000 pairs per call. */
export function kvBulkPutSpec(
  namespaceId: string,
  entries: readonly { readonly key: string; readonly value: string }[],
): RequestSpec {
  return {
    method: 'PUT',
    path: `/storage/kv/namespaces/${seg(namespaceId)}/bulk`,
    body: entries.map((e) => ({ key: e.key, value: e.value })),
  }
}

/** Bulk delete. */
export function kvBulkDeleteSpec(namespaceId: string, keys: readonly string[]): RequestSpec {
  return {
    method: 'POST',
    path: `/storage/kv/namespaces/${seg(namespaceId)}/bulk/delete`,
    body: keys,
  }
}

// --- D1 -------------------------------------------------------------------

/** List D1 databases. The resource is singular: `/d1/database`. */
export function d1ListSpec(perPage: number): RequestSpec {
  return { method: 'GET', path: '/d1/database', query: { per_page: perPage } }
}

/**
 * Run SQL against a database.
 *
 * There is no `/exec` endpoint; `/query` handles multi-statement SQL.
 */
export function d1QuerySpec(databaseId: string, sql: string, params: readonly string[]): RequestSpec {
  return {
    method: 'POST',
    path: `/d1/database/${seg(databaseId)}/query`,
    body: { sql, params },
  }
}

// --- Queues ---------------------------------------------------------------

/** List queues. */
export function queueListSpec(perPage: number): RequestSpec {
  return { method: 'GET', path: '/queues', query: { per_page: perPage } }
}

/** Push one message. */
export function queueSendSpec(queueId: string, body: unknown): RequestSpec {
  return { method: 'POST', path: `/queues/${seg(queueId)}/messages`, body: { body } }
}

/**
 * Pull a batch for processing.
 *
 * Messages come back with a `lease_id`; the visibility timeout defaults to 30s
 * server-side and may be up to 12 hours.
 */
export function queuePullSpec(queueId: string, batchSize: number, visibilityTimeoutMs: number): RequestSpec {
  return {
    method: 'POST',
    path: `/queues/${seg(queueId)}/messages/pull`,
    body: { batch_size: batchSize, visibility_timeout_ms: visibilityTimeoutMs },
  }
}

/** Acknowledge and/or retry pulled messages by lease id. */
export function queueAckSpec(
  queueId: string,
  acks: readonly string[],
  retries: readonly string[],
): RequestSpec {
  return {
    method: 'POST',
    path: `/queues/${seg(queueId)}/messages/ack`,
    body: {
      acks: acks.map((leaseId) => ({ lease_id: leaseId })),
      retries: retries.map((leaseId) => ({ lease_id: leaseId })),
    },
  }
}

// --- R2 (bucket management; objects go through the S3 API) ----------------

/** List R2 buckets. */
export function r2BucketListSpec(perPage: number): RequestSpec {
  return { method: 'GET', path: '/r2/buckets', query: { per_page: perPage } }
}

/** Create an R2 bucket. */
export function r2BucketCreateSpec(name: string, locationHint: string | undefined): RequestSpec {
  return {
    method: 'POST',
    path: '/r2/buckets',
    body: { name, ...(locationHint === undefined ? {} : { locationHint }) },
  }
}

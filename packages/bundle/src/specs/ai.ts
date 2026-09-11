/**
 * Pure request-spec builders for the AI tools.
 *
 * Note the REST prefix for gateway management is `/ai-gateway/gateways`
 * (hyphenated), not `/ai/gateways`.
 */
import type { RequestSpec } from '@d4551/dsh-cloudflare-core'
import { seg } from './_segment.ts'

// --- Workers AI -----------------------------------------------------------

/** Run a Workers AI model. `model` is a slug like `@cf/meta/llama-3.1-8b-instruct`. */
export function aiRunSpec(model: string, input: unknown): RequestSpec {
  return { method: 'POST', path: `/ai/run/${model.split('/').map(seg).join('/')}`, body: input }
}

/** Search the Workers AI model catalogue. */
export function aiModelsSearchSpec(
  search: string | undefined,
  task: string | undefined,
  page: number,
  perPage: number,
): RequestSpec {
  return {
    method: 'GET',
    path: '/ai/models/search',
    query: {
      page,
      per_page: perPage,
      ...(search === undefined ? {} : { search }),
      ...(task === undefined ? {} : { task }),
    },
  }
}

/** Fetch the JSON schema Cloudflare publishes for one model. */
export function aiModelSchemaSpec(model: string): RequestSpec {
  return { method: 'GET', path: '/ai/models/schema', query: { model } }
}

// --- AI Gateway -----------------------------------------------------------

/** List gateways. */
export function gatewayListSpec(page: number, perPage: number): RequestSpec {
  return { method: 'GET', path: '/ai-gateway/gateways', query: { page, per_page: perPage } }
}

/** Fetch one gateway. */
export function gatewayGetSpec(gatewayId: string): RequestSpec {
  return { method: 'GET', path: `/ai-gateway/gateways/${seg(gatewayId)}` }
}

/**
 * Resolve the gateway's base URL for one provider.
 *
 * Used instead of hardcoding an endpoint, so the adapter always talks to the
 * URL Cloudflare currently advertises.
 */
export function gatewayUrlSpec(gatewayId: string, provider: string): RequestSpec {
  return { method: 'GET', path: `/ai-gateway/gateways/${seg(gatewayId)}/url/${seg(provider)}` }
}

/** Fields the gateway logs endpoint can filter on. */
type GatewayLogFilterKey =
  | 'id'
  | 'created_at'
  | 'request_type'
  | 'success'
  | 'cached'
  | 'provider'
  | 'model'
  | 'model_type'
  | 'cost'
  | 'tokens'
  | 'tokens_in'
  | 'tokens_out'
  | 'duration'
  | 'feedback'
  | 'event_id'
  | 'metadata.key'
  | 'metadata.value'

/** Comparisons the gateway logs endpoint accepts. */
type GatewayLogFilterOperator = 'eq' | 'neq' | 'contains' | 'lt' | 'gt'

/** Every filterable field, in the order the model sees them. */
export const GATEWAY_LOG_FILTER_KEYS: readonly GatewayLogFilterKey[] = [
  'id',
  'created_at',
  'request_type',
  'success',
  'cached',
  'provider',
  'model',
  'model_type',
  'cost',
  'tokens',
  'tokens_in',
  'tokens_out',
  'duration',
  'feedback',
  'event_id',
  'metadata.key',
  'metadata.value',
]

/** Every accepted comparison, in the order the model sees them. */
export const GATEWAY_LOG_FILTER_OPERATORS: readonly GatewayLogFilterOperator[] = [
  'eq',
  'neq',
  'contains',
  'lt',
  'gt',
]

/** One filter clause. */
interface GatewayLogFilter {
  readonly key: GatewayLogFilterKey
  readonly operator: GatewayLogFilterOperator
  readonly value: string
}

/**
 * Page-size bounds the endpoint documents.
 *
 * Protocol facts, not tunables: sending a larger page is rejected by the
 * server, so clamping here would hide a caller's mistake rather than surface it.
 */
export const GATEWAY_LOG_MIN_PAGE_SIZE = 1
export const GATEWAY_LOG_MAX_PAGE_SIZE = 50

/** Raised when a caller asks for a page the endpoint will not serve. */
export class GatewayLogPageSizeError extends RangeError {
  override readonly name = 'GatewayLogPageSizeError'
  constructor(perPage: number) {
    super(
      `perPage must be between ${GATEWAY_LOG_MIN_PAGE_SIZE} and ${GATEWAY_LOG_MAX_PAGE_SIZE}, got ${perPage}`,
    )
  }
}

/**
 * Read one page of gateway logs.
 *
 * The endpoint is page-numbered, not cursor-paginated, and its `filters`
 * parameter is an array of clauses. Cloudflare's own SDKs serialize that array
 * as dotted positional repeats —
 * `filters.key=…&filters.operator=…&filters.value=…` once per clause — so the
 * clauses go through `orderedQuery`, where repetition and order survive.
 */
export function gatewayLogsSpec(
  gatewayId: string,
  page: number,
  perPage: number,
  filters: readonly GatewayLogFilter[],
): RequestSpec {
  if (perPage < GATEWAY_LOG_MIN_PAGE_SIZE || perPage > GATEWAY_LOG_MAX_PAGE_SIZE) {
    throw new GatewayLogPageSizeError(perPage)
  }
  return {
    method: 'GET',
    path: `/ai-gateway/gateways/${seg(gatewayId)}/logs`,
    query: { page, per_page: perPage },
    orderedQuery: filters.flatMap((filter) => [
      ['filters.key', filter.key],
      ['filters.operator', filter.operator],
      ['filters.value', filter.value],
    ]),
  }
}

/**
 * The clauses that select one harness session's requests.
 *
 * Two clauses because the endpoint exposes `metadata.key` and `metadata.value`
 * as separate filterable fields — there is no `metadata.sessionId` field.
 */
export function sessionLogFilters(sessionId: string, metadataKey: string): readonly GatewayLogFilter[] {
  return [
    { key: 'metadata.key', operator: 'eq', value: metadataKey },
    { key: 'metadata.value', operator: 'eq', value: sessionId },
  ]
}

/** Fetch a single log's request or response body. */
export function gatewayLogBodySpec(
  gatewayId: string,
  logId: string,
  part: 'request' | 'response',
): RequestSpec {
  return {
    method: 'GET',
    path: `/ai-gateway/gateways/${seg(gatewayId)}/logs/${seg(logId)}/${part}`,
  }
}

/** List dynamic routes for a gateway. */
export function gatewayRouteListSpec(gatewayId: string): RequestSpec {
  return { method: 'GET', path: `/ai-gateway/gateways/${seg(gatewayId)}/routes` }
}

/** Billing endpoints exposed as a single read tool. */
export type BillingView = 'credit-balance' | 'usage-history' | 'invoice-preview'

/** Read one billing view. */
export function gatewayBillingSpec(view: BillingView): RequestSpec {
  return { method: 'GET', path: `/ai-gateway/billing/${view}` }
}

// --- AI Search (formerly AutoRAG) ----------------------------------------

/** Search an AI Search instance. */
export function aiSearchSearchSpec(instanceId: string, query: string, maxResults: number): RequestSpec {
  return {
    method: 'POST',
    path: `/ai-search/instances/${seg(instanceId)}/search`,
    body: { query, max_num_results: maxResults },
  }
}

/** Ask an AI Search instance for a grounded answer. */
export function aiSearchChatSpec(instanceId: string, query: string, model: string | undefined): RequestSpec {
  return {
    method: 'POST',
    path: `/ai-search/instances/${seg(instanceId)}/chat/completions`,
    body: {
      messages: [{ role: 'user', content: query }],
      ...(model === undefined ? {} : { model }),
    },
  }
}

/** Trigger a sync job for an AI Search instance. */
export function aiSearchSyncSpec(instanceId: string): RequestSpec {
  return { method: 'POST', path: `/ai-search/instances/${seg(instanceId)}/jobs` }
}

// --- Vectorize ------------------------------------------------------------

/** The Vectorize REST path; the `v2` segment is the API's own versioning. */
const VECTORIZE_INDEXES = '/vectorize/v2/indexes'

/** List Vectorize indexes. */
export function vectorizeIndexListSpec(): RequestSpec {
  return { method: 'GET', path: VECTORIZE_INDEXES }
}

/**
 * How much stored metadata a query returns. Cloudflare's three values are not
 * a boolean: `indexed` returns only the fields the index was told to index,
 * which is the difference between a cheap query and a complete one.
 */
type VectorizeMetadataMode = 'none' | 'indexed' | 'all'

/** Every {@link VectorizeMetadataMode}, in the order the API documents them. */
export const VECTORIZE_METADATA_MODES: readonly VectorizeMetadataMode[] = ['none', 'indexed', 'all']

/** What the upsert endpoint does with a line it cannot parse. */
type UnparsableBehavior = 'error' | 'discard'

/** Every {@link UnparsableBehavior}, in the order the API documents them. */
export const UNPARSABLE_BEHAVIORS: readonly UnparsableBehavior[] = ['error', 'discard']

/** One vector as the insert and upsert endpoints read it. */
interface VectorizeVector {
  readonly id: string
  readonly values: readonly number[]
  readonly metadata?: unknown
}

/** Query an index by vector. */
export function vectorizeQuerySpec(
  indexName: string,
  vector: readonly number[],
  topK: number,
  returnValues: boolean,
  returnMetadata: VectorizeMetadataMode,
): RequestSpec {
  return {
    method: 'POST',
    path: `/vectorize/v2/indexes/${seg(indexName)}/query`,
    body: { vector, topK, returnValues, returnMetadata },
  }
}

/**
 * Write vectors to an index.
 *
 * The body is NDJSON — one vector per line, not one JSON document — so it is
 * encoded here rather than serialized by the client. `upsert` replaces a
 * vector that already carries the id; `insert` leaves it alone.
 */
export function vectorizeWriteSpec(
  indexName: string,
  operation: 'insert' | 'upsert',
  vectors: readonly VectorizeVector[],
  unparsable: UnparsableBehavior,
): RequestSpec {
  return {
    method: 'POST',
    path: `/vectorize/v2/indexes/${seg(indexName)}/${operation}`,
    query: { 'unparsable-behavior': unparsable },
    encodedBody: {
      contentType: 'application/x-ndjson',
      text: vectors
        .map((vector) => JSON.stringify({ id: vector.id, values: vector.values, metadata: vector.metadata }))
        .join('\n'),
    },
  }
}

/** Delete vectors by id. */
export function vectorizeDeleteByIdsSpec(indexName: string, ids: readonly string[]): RequestSpec {
  return {
    method: 'POST',
    path: `/vectorize/v2/indexes/${seg(indexName)}/delete_by_ids`,
    body: { ids },
  }
}

/** Read vectors back by id. */
export function vectorizeGetByIdsSpec(indexName: string, ids: readonly string[]): RequestSpec {
  return {
    method: 'POST',
    path: `/vectorize/v2/indexes/${seg(indexName)}/get_by_ids`,
    body: { ids },
  }
}

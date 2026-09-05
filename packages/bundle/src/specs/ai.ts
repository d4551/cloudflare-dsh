/**
 * Pure request-spec builders for the AI tools.
 *
 * Note the REST prefix for gateway management is `/ai-gateway/gateways`
 * (hyphenated), not `/ai/gateways`.
 */
import type { RequestSpec } from '@d4551/dsh-cloudflare-core'

function seg(value: string): string {
  return encodeURIComponent(value)
}

// --- Workers AI -----------------------------------------------------------

/** Run a Workers AI model. `model` is a slug like `@cf/meta/llama-3.1-8b-instruct`. */
export function aiRunSpec(model: string, input: unknown): RequestSpec {
  return { method: 'POST', path: `/ai/run/${model.split('/').map(seg).join('/')}`, body: input }
}

/** Search the Workers AI model catalogue. */
export function aiModelsSearchSpec(
  search: string | undefined,
  task: string | undefined,
  perPage: number,
): RequestSpec {
  return {
    method: 'GET',
    path: '/ai/models/search',
    query: {
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
export function gatewayListSpec(perPage: number): RequestSpec {
  return { method: 'GET', path: '/ai-gateway/gateways', query: { per_page: perPage } }
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

/** Query gateway request logs. */
export function gatewayLogsSpec(
  gatewayId: string,
  perPage: number,
  filters: Readonly<Record<string, string | undefined>>,
): RequestSpec {
  const query: Record<string, string | number> = { per_page: perPage }
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query[key] = value
  }
  return { method: 'GET', path: `/ai-gateway/gateways/${seg(gatewayId)}/logs`, query }
}

/** Fetch a single log's request or response body. */
export function gatewayLogBodySpec(gatewayId: string, logId: string, part: 'request' | 'response'): RequestSpec {
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

/** List Vectorize indexes. Note the `/v2/` version segment. */
export function vectorizeIndexListSpec(): RequestSpec {
  return { method: 'GET', path: '/vectorize/v2/indexes' }
}

/** Query an index by vector. */
export function vectorizeQuerySpec(
  indexName: string,
  vector: readonly number[],
  topK: number,
  returnValues: boolean,
  returnMetadata: boolean,
): RequestSpec {
  return {
    method: 'POST',
    path: `/vectorize/v2/indexes/${seg(indexName)}/query`,
    body: {
      vector,
      topK,
      returnValues,
      returnMetadata: returnMetadata ? 'all' : 'none',
    },
  }
}

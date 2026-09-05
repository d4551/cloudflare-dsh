/**
 * Workers AI, AI Gateway and AI Search tools.
 *
 * The gateway tools are what make the model provider (see `../ai/`) legible:
 * once requests carry a session id in `cf-aig-metadata`, these read back the
 * cost, cache behaviour and latency for that exact session.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  type BillingView,
  aiModelSchemaSpec,
  aiModelsSearchSpec,
  aiRunSpec,
  aiSearchChatSpec,
  aiSearchSearchSpec,
  aiSearchSyncSpec,
  gatewayBillingSpec,
  gatewayGetSpec,
  gatewayListSpec,
  gatewayLogBodySpec,
  gatewayLogsSpec,
  gatewayRouteListSpec,
  vectorizeIndexListSpec,
  vectorizeQuerySpec,
} from '../specs/ai.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, listing, text } from './_shared/render.ts'

interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** Billing views the cost tool exposes. */
const BILLING_VIEWS: readonly BillingView[] = ['credit-balance', 'usage-history', 'invoice-preview']

export const name = 'cloudflare-tools-ai'
export const inject = ['tools', 'cloudflare'] as const

export function apply(ctx: Context): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_run',
      description:
        'Run a Workers AI model. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape.',
      parameters: {
        model: { type: 'string', required: true, description: 'Model slug, e.g. @cf/meta/llama-3.1-8b-instruct.' },
        input: { type: 'json', required: true, description: 'Model input, matching that model’s schema.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The model output.' },
        render: (_args, value) => json((value as { output: JsonValue }).output),
      },
      timeoutMs: 120_000,
      async execute(args) {
        const output = await cf.accountRequest<JsonValue>(aiRunSpec(args.model, args.input))
        return { model: args.model, output }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_models_search',
      description: 'Search the Workers AI model catalogue by name or task.',
      parameters: {
        search: { type: 'string', description: 'Substring to match against model names.' },
        task: { type: 'string', description: 'Task filter, e.g. "Text Generation".' },
        perPage: { type: 'integer', description: 'Models per page (default 50).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Matching models.' },
        render: (_args, value) => listing((value as { models: unknown[] }).models.length, 'model', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const models = await cf.accountRequest<JsonValue[]>(
          aiModelsSearchSpec(args.search, args.task, args.perPage ?? 50),
        )
        return { models }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_model_schema',
      description:
        'Fetch the JSON schema Cloudflare publishes for one Workers AI model, so cloudflare_ai_run can be called with the right input shape.',
      parameters: { model: { type: 'string', required: true, description: 'Model slug.' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The model’s published JSON schema.' },
        render: (_args, value) => json((value as { schema: JsonValue }).schema),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const schema = await cf.accountRequest<JsonValue>(aiModelSchemaSpec(args.model))
        return { model: args.model, schema }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_list',
      description: 'List the AI Gateways in the Cloudflare account.',
      parameters: { perPage: { type: 'integer', description: 'Gateways per page (default 50).' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Gateways with their ids and settings.' },
        render: (_args, value) => listing((value as { gateways: unknown[] }).gateways.length, 'gateway', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const gateways = await cf.accountRequest<JsonValue[]>(gatewayListSpec(args.perPage ?? 50))
        return { gateways }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_get',
      description: 'Fetch one AI Gateway’s configuration.',
      parameters: { gatewayId: { type: 'string', required: true, description: 'Gateway id.' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The gateway configuration.' },
        render: (_args, value) => json((value as { gateway: JsonValue }).gateway),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const gateway = await cf.accountRequest<JsonValue>(gatewayGetSpec(args.gatewayId))
        return { gateway }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_logs',
      description:
        'Query AI Gateway request logs. Filter by metadata to isolate one harness session: requests made through the Cloudflare model provider carry the session id in cf-aig-metadata.',
      parameters: {
        gatewayId: { type: 'string', required: true, description: 'Gateway id.' },
        perPage: { type: 'integer', description: 'Log entries per page (default 50).' },
        filters: {
          type: 'object',
          additionalProperties: true,
          description: 'Extra query filters, e.g. { "metadata.sessionId": "..." }.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Matching log entries.' },
        render: (_args, value) => listing((value as { logs: unknown[] }).logs.length, 'log entry', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const filters = (args.filters ?? {}) as Record<string, string | undefined>
        const logs = await cf.accountRequest<JsonValue[]>(
          gatewayLogsSpec(args.gatewayId, args.perPage ?? 50, filters),
        )
        return { logs }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_log_body',
      description: 'Fetch the stored request or response body for one AI Gateway log entry.',
      parameters: {
        gatewayId: { type: 'string', required: true, description: 'Gateway id.' },
        logId: { type: 'string', required: true, description: 'Log entry id.' },
        part: {
          type: 'string',
          required: true,
          enum: ['request', 'response'],
          description: 'Which body to fetch.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The stored body.' },
        render: (_args, value) => json((value as { body: JsonValue }).body),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const body = await cf.accountRequest<JsonValue>(
          gatewayLogBodySpec(args.gatewayId, args.logId, args.part as 'request' | 'response'),
        )
        return { body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_routes',
      description: 'List the dynamic routing rules configured on an AI Gateway.',
      parameters: { gatewayId: { type: 'string', required: true, description: 'Gateway id.' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Dynamic routes.' },
        render: (_args, value) => listing((value as { routes: unknown[] }).routes.length, 'route', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const routes = await cf.accountRequest<JsonValue[]>(gatewayRouteListSpec(args.gatewayId))
        return { routes }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_cost',
      description:
        'Read AI Gateway billing: the prepaid credit balance, usage history, or the current invoice preview.',
      parameters: {
        view: {
          type: 'string',
          required: true,
          enum: BILLING_VIEWS,
          description: 'Which billing view to read.',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The requested billing view.' },
        render: (_args, value) => json((value as { billing: JsonValue }).billing),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const billing = await cf.accountRequest<JsonValue>(gatewayBillingSpec(args.view as BillingView))
        return { view: args.view, billing }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aisearch_search',
      description:
        'Search an AI Search instance (formerly AutoRAG) and return the matching chunks, without generating an answer.',
      parameters: {
        instanceId: { type: 'string', required: true, description: 'AI Search instance id.' },
        query: { type: 'string', required: true, description: 'Search query.' },
        maxResults: { type: 'integer', description: 'Maximum chunks to return (default 10).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Matching chunks.' },
        render: (_args, value) => json((value as { results: JsonValue }).results),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const results = await cf.accountRequest<JsonValue>(
          aiSearchSearchSpec(args.instanceId, args.query, args.maxResults ?? 10),
        )
        return { results }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aisearch_chat',
      description: 'Ask an AI Search instance a question and get an answer grounded in its indexed content.',
      parameters: {
        instanceId: { type: 'string', required: true, description: 'AI Search instance id.' },
        query: { type: 'string', required: true, description: 'Question to answer.' },
        model: { type: 'string', description: 'Override the generating model.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The grounded completion.' },
        render: (_args, value) => json((value as { answer: JsonValue }).answer),
      },
      timeoutMs: 120_000,
      async execute(args) {
        const answer = await cf.accountRequest<JsonValue>(
          aiSearchChatSpec(args.instanceId, args.query, args.model),
        )
        return { answer }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aisearch_sync',
      description: 'Trigger an indexing job for an AI Search instance so new source content is picked up.',
      parameters: {
        instanceId: { type: 'string', required: true, description: 'AI Search instance id.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The created sync job.' },
        render: (_args, value) => json((value as { job: JsonValue }).job),
      },
      async execute(args) {
        const job = await cf.accountRequest<JsonValue>(aiSearchSyncSpec(args.instanceId))
        return { job }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_vectorize_index_list',
      description: 'List the Vectorize indexes in the Cloudflare account.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Vectorize indexes.' },
        render: (_args, value) => listing((value as { indexes: unknown[] }).indexes.length, 'index', value),
      },
      isConcurrencySafe: () => true,
      async execute() {
        const indexes = await cf.accountRequest<JsonValue[]>(vectorizeIndexListSpec())
        return { indexes }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_vectorize_query',
      description: 'Query a Vectorize index by vector and return the nearest matches.',
      parameters: {
        indexName: { type: 'string', required: true, description: 'Index name.' },
        vector: {
          type: 'array',
          required: true,
          description: 'Query vector.',
          items: { type: 'number' },
        },
        topK: { type: 'integer', description: 'How many matches to return (default 5).' },
        returnValues: { type: 'boolean', description: 'Include stored vectors in the response.' },
        returnMetadata: { type: 'boolean', description: 'Include stored metadata in the response.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Nearest matches.' },
        render: (_args, value) => json((value as { matches: JsonValue }).matches),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const matches = await cf.accountRequest<JsonValue>(
          vectorizeQuerySpec(
            args.indexName,
            args.vector as readonly number[],
            args.topK ?? 5,
            args.returnValues ?? false,
            args.returnMetadata ?? true,
          ),
        )
        return { matches }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_session_cost',
      description:
        'Summarise what one harness session cost through AI Gateway, by reading the gateway logs tagged with that session id.',
      parameters: {
        gatewayId: { type: 'string', required: true, description: 'Gateway id.' },
        sessionId: { type: 'string', required: true, description: 'Harness session id.' },
        perPage: { type: 'integer', description: 'Log entries to scan (default 100).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'Request count, total cost, tokens, and cache hits for the session.',
        },
        render: (args, value) => {
          const v = value as { requests: number; cost: number; cached: number }
          return text(
            `Session ${args.sessionId}: ${v.requests} requests, ${v.cached} served from cache, cost ${v.cost}.`,
          )
        },
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const logs = await cf.accountRequest<JsonValue[]>(
          gatewayLogsSpec(args.gatewayId, args.perPage ?? 100, {
            'metadata.sessionId': args.sessionId,
          }),
        )
        return summariseSessionLogs(logs)
      },
    }),
  )
}

/** One gateway log entry, in the shape the summary reads. */
export interface GatewayLogEntry {
  readonly cost?: number
  readonly tokens_in?: number
  readonly tokens_out?: number
  readonly cached?: boolean
}

/**
 * Reduce gateway log entries to a session summary.
 *
 * Pure, so the arithmetic is unit-testable without a gateway; missing fields
 * count as zero because Cloudflare omits them for some providers.
 */
export function summariseSessionLogs(logs: readonly JsonValue[]): {
  requests: number
  cost: number
  tokensIn: number
  tokensOut: number
  cached: number
} {
  let cost = 0
  let tokensIn = 0
  let tokensOut = 0
  let cached = 0
  for (const entry of logs) {
    const log = entry as GatewayLogEntry
    cost += log.cost ?? 0
    tokensIn += log.tokens_in ?? 0
    tokensOut += log.tokens_out ?? 0
    if (log.cached === true) cached += 1
  }
  return { requests: logs.length, cost, tokensIn, tokensOut, cached }
}

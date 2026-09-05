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
import Schema from '@deepseek-ai/schemastery'
import { nextPageQuery } from '@d4551/dsh-cloudflare-core'
import { SESSION_METADATA_KEY } from '../ai/headers.ts'
import {
  GATEWAY_LOG_MAX_PAGE_SIZE,
  GATEWAY_LOG_MIN_PAGE_SIZE,
  type BillingView,
  type GatewayLogFilter,
  type GatewayLogFilterKey,
  type GatewayLogFilterOperator,
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
  sessionLogFilters,
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
export const inject = ['tools', 'cloudflare']

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

export function apply(ctx: Context, config: AiToolsConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_run',
      description:
        'Run a Workers AI model. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape.',
      parameters: {
        model: {
          type: 'string',
          required: true,
          description: 'Model slug, e.g. @cf/meta/llama-3.1-8b-instruct.',
        },
        input: { type: 'json', required: true, description: 'Model input, matching that model’s schema.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'The model output.' },
        render: (_args, value) => json((value as { output: JsonValue }).output),
      },
      timeoutMs: config.inferenceTimeoutMs,
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
        perPage: { type: 'integer', description: `Models per page (default ${config.pageSize}).` },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Matching models.' },
        render: (_args, value) => listing((value as { models: unknown[] }).models.length, 'model', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const models = await cf.accountRequest<JsonValue[]>(
          aiModelsSearchSpec(args.search, args.task, args.perPage ?? config.pageSize),
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
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'The model’s published JSON schema.',
        },
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
      parameters: {
        perPage: { type: 'integer', description: `Gateways per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'Gateways with their ids and settings.',
        },
        render: (_args, value) =>
          listing((value as { gateways: unknown[] }).gateways.length, 'gateway', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const gateways = await cf.accountRequest<JsonValue[]>(
          gatewayListSpec(args.perPage ?? config.pageSize),
        )
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
        page: { type: 'integer', description: '1-based page number (default 1).' },
        perPage: {
          type: 'integer',
          description: `Log entries per page, ${GATEWAY_LOG_MIN_PAGE_SIZE}-${GATEWAY_LOG_MAX_PAGE_SIZE} (default ${GATEWAY_LOG_MAX_PAGE_SIZE}).`,
        },
        filters: {
          type: 'array',
          description:
            'Filter clauses. Metadata is filtered as two clauses — {"key":"metadata.key","operator":"eq","value":"sessionId"} and {"key":"metadata.value","operator":"eq","value":"<id>"} — because the endpoint exposes key and value as separate fields.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', required: true },
              operator: { type: 'string', required: true },
              value: { type: 'string', required: true },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'Matching log entries and the page they came from.',
        },
        render: (_args, value) => listing((value as { logs: unknown[] }).logs.length, 'log entry', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const page = args.page ?? 1
        const perPage = args.perPage ?? GATEWAY_LOG_MAX_PAGE_SIZE
        const logs = await cf.accountRequest<JsonValue[]>(
          gatewayLogsSpec(args.gatewayId, page, perPage, toLogFilters(args.filters)),
        )
        return { logs, page, perPage, complete: logs.length < perPage }
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
        maxResults: {
          type: 'integer',
          description: `Maximum chunks to return (default ${config.searchMaxResults}).`,
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Matching chunks.' },
        render: (_args, value) => json((value as { results: JsonValue }).results),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const results = await cf.accountRequest<JsonValue>(
          aiSearchSearchSpec(args.instanceId, args.query, args.maxResults ?? config.searchMaxResults),
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
      timeoutMs: config.inferenceTimeoutMs,
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
        topK: { type: 'integer', description: `How many matches to return (default ${config.vectorTopK}).` },
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
            args.topK ?? config.vectorTopK,
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
        perPage: {
          type: 'integer',
          description: `Log entries per page while scanning, ${GATEWAY_LOG_MIN_PAGE_SIZE}-${GATEWAY_LOG_MAX_PAGE_SIZE} (default ${GATEWAY_LOG_MAX_PAGE_SIZE}).`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'Request count, total cost, tokens, and cache hits for the session.',
        },
        render: (args, value) => {
          const v = value as { requests: number; cost: number; cached: number; truncated: boolean }
          const partial = v.truncated ? ' (partial: the page ceiling stopped the scan)' : ''
          return text(
            `Session ${args.sessionId}: ${v.requests} requests, ${v.cached} served from cache, cost ${v.cost}${partial}.`,
          )
        },
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const perPage = args.perPage ?? GATEWAY_LOG_MAX_PAGE_SIZE
        const walk = await cf.accountListAll<JsonValue>(
          gatewayLogsSpec(
            args.gatewayId,
            1,
            perPage,
            sessionLogFilters(args.sessionId, SESSION_METADATA_KEY),
          ),
          nextPageQuery,
        )
        // The server filter is sent, and every row is re-checked here against
        // the metadata it actually carries. Cloudflare's schema does not
        // document how positional filter repeats are paired, so a filter the
        // server ignores would return every session's logs — and the failure
        // that repair exists for is one session being billed another's cost.
        // Verifying locally makes the result correct either way.
        const matched = walk.items.filter((row) => sessionOf(row) === args.sessionId)
        return {
          ...summariseSessionLogs(matched),
          scanned: walk.items.length,
          pages: walk.pages,
          truncated: walk.truncated,
        }
      },
    }),
  )
}

/**
 * Build a lookup that both validates an unknown value and narrows it.
 *
 * A `Set<string>` cannot be queried with an `unknown`, which is what forces the
 * redundant `typeof` guard this replaces; a map keyed by `unknown` can, and its
 * value type carries the narrowing.
 */
function lookup<T extends string>(...members: readonly T[]): ReadonlyMap<unknown, T> {
  const map = new Map<unknown, T>()
  for (const member of members) map.set(member, member)
  return map
}

/** Filter keys the logs endpoint accepts, for validating caller input. */
const LOG_FILTER_KEYS = lookup<GatewayLogFilterKey>(
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
)

/** Comparisons the logs endpoint accepts. */
const LOG_FILTER_OPERATORS = lookup<GatewayLogFilterOperator>('eq', 'neq', 'contains', 'lt', 'gt')

/** Raised when a caller supplies a filter the endpoint cannot express. */
export class GatewayLogFilterError extends TypeError {
  override readonly name = 'GatewayLogFilterError'
}

/**
 * Validate caller-supplied filter clauses.
 *
 * Checked rather than cast: the previous shape was a free-form object cast to
 * `Record<string, string>`, so a non-string value reached `String(value)` and
 * went on the wire as `"[object Object]"`.
 */
export function toLogFilters(raw: unknown): readonly GatewayLogFilter[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new GatewayLogFilterError('filters must be an array of clauses')
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new GatewayLogFilterError(`filters[${index}] must be an object`)
    }
    const { key: rawKey, operator: rawOperator, value } = entry as Record<string, unknown>
    const key = LOG_FILTER_KEYS.get(rawKey)
    if (key === undefined) {
      throw new GatewayLogFilterError(
        `filters[${index}].key ${JSON.stringify(rawKey)} is not a filterable field`,
      )
    }
    const operator = LOG_FILTER_OPERATORS.get(rawOperator)
    if (operator === undefined) {
      throw new GatewayLogFilterError(
        `filters[${index}].operator ${JSON.stringify(rawOperator)} is not a supported comparison`,
      )
    }
    if (typeof value !== 'string') {
      throw new GatewayLogFilterError(`filters[${index}].value must be a string`)
    }
    return { key, operator, value }
  })
}

/** One gateway log entry, in the shape the summary reads. */
export interface GatewayLogEntry {
  readonly cost?: number
  readonly tokens_in?: number
  readonly tokens_out?: number
  readonly cached?: boolean
  /** Request metadata, which the API returns as a JSON string. */
  readonly metadata?: unknown
}

/** Raised when a log entry carries a field the summary cannot add up. */
export class GatewayLogShapeError extends TypeError {
  override readonly name = 'GatewayLogShapeError'
  constructor(field: string, value: unknown) {
    super(
      `gateway log field ${field} must be a number, got ${typeof value} (${JSON.stringify(value)}). ` +
        'Summing it would produce a total that is silently wrong.',
    )
  }
}

/** Read one numeric field, refusing a value that would corrupt the total. */
function numericField(log: GatewayLogEntry, field: 'cost' | 'tokens_in' | 'tokens_out'): number {
  const value = log[field]
  if (value === undefined) return 0
  // `cost += "0.004"` concatenates and turns the running total into a string.
  // A decimal returned as a string is a plausible API shape, so it is rejected
  // rather than added. `Number.isFinite` does not coerce, so it rejects every
  // non-number as well as NaN and the infinities — no separate `typeof` arm.
  if (!Number.isFinite(value)) throw new GatewayLogShapeError(field, value)
  return value
}

/**
 * The session id a log entry actually carries.
 *
 * The API returns `metadata` as a JSON string, so this parses it rather than
 * trusting the server-side filter to have been applied.
 */
export function sessionOf(entry: JsonValue): string | undefined {
  const metadata = (entry as GatewayLogEntry).metadata
  let parsed: unknown
  try {
    // No separate string guard: `JSON.parse` coerces its argument, and every
    // non-string value either throws here or fails the object check below, so
    // a guard would be a branch nothing could observe.
    parsed = JSON.parse(String(metadata))
  } catch {
    return undefined
  }
  // Only `null` needs guarding: indexing a number or a string yields
  // `undefined`, which the string check below rejects anyway.
  if (parsed === null) return undefined
  const value = (parsed as Record<string, unknown>)[SESSION_METADATA_KEY]
  return typeof value === 'string' ? value : undefined
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
    cost += numericField(log, 'cost')
    tokensIn += numericField(log, 'tokens_in')
    tokensOut += numericField(log, 'tokens_out')
    if (log.cached === true) cached += 1
  }
  return { requests: logs.length, cost, tokensIn, tokensOut, cached }
}

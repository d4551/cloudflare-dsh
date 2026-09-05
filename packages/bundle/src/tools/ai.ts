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
import { parseJson } from '../ai/sse.ts'
import {
  GATEWAY_LOG_FILTER_KEYS,
  GATEWAY_LOG_FILTER_OPERATORS,
  GATEWAY_LOG_MAX_PAGE_SIZE,
  GATEWAY_LOG_MIN_PAGE_SIZE,
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
  sessionLogFilters,
  vectorizeIndexListSpec,
  vectorizeQuerySpec,
} from '../specs/ai.ts'
import { isFiniteNumber, isObject, type JsonValue } from './_shared/json.ts'
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The model that ran and what it returned.',
          properties: {
            model: { type: 'string', required: true, description: 'Model slug that produced the output.' },
            output: {
              type: 'json',
              required: true,
              description: 'The model output as Workers AI returned it.',
            },
          },
        },
        render: (_args, value) => json(value.output),
      },
      timeoutMs: config.inferenceTimeoutMs,
      async execute(args, exec) {
        const output = await cf.accountRequest<JsonValue>({
          ...aiRunSpec(args.model, args.input),
          signal: exec.signal,
          timeoutMs: config.inferenceTimeoutMs,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Model catalogue entries.',
          properties: {
            models: {
              type: 'array',
              required: true,
              description: 'Catalogue entries as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.models.length, 'model', value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const models = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...aiModelsSearchSpec(args.search, args.task, args.perPage ?? config.pageSize),
          signal: exec.signal,
        })
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
          additionalProperties: false,
          description: 'The model and its published JSON schema.',
          properties: {
            model: { type: 'string', required: true, description: 'Model slug the schema describes.' },
            schema: {
              type: 'json',
              required: true,
              description: 'The JSON schema Cloudflare publishes for the model.',
            },
          },
        },
        render: (_args, value) => json(value.schema),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const schema = await cf.accountRequest<JsonValue>({
          ...aiModelSchemaSpec(args.model),
          signal: exec.signal,
        })
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
          additionalProperties: false,
          description: 'Gateways in the account.',
          properties: {
            gateways: {
              type: 'array',
              required: true,
              description: 'Gateway records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.gateways.length, 'gateway', value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const gateways = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...gatewayListSpec(args.perPage ?? config.pageSize),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One gateway.',
          properties: {
            gateway: {
              type: 'object',
              required: true,
              additionalProperties: true,
              description: 'The gateway record as the API returns it.',
            },
          },
        },
        render: (_args, value) => json(value.gateway),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const gateway = await cf.accountRequest<Record<string, JsonValue>>({
          ...gatewayGetSpec(args.gatewayId),
          signal: exec.signal,
        })
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
              key: { type: 'string', required: true, enum: GATEWAY_LOG_FILTER_KEYS },
              operator: { type: 'string', required: true, enum: GATEWAY_LOG_FILTER_OPERATORS },
              value: { type: 'string', required: true },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Matching log entries and the page they came from.',
          properties: {
            logs: {
              type: 'array',
              required: true,
              description: 'Log entries as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
            page: { type: 'integer', required: true, description: '1-based page number that was read.' },
            perPage: { type: 'integer', required: true, description: 'Entries requested per page.' },
            complete: {
              type: 'boolean',
              required: true,
              description: 'Whether this page was short, so no page follows.',
            },
          },
        },
        render: (_args, value) => listing(value.logs.length, 'log entry', value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = args.page ?? 1
        const perPage = args.perPage ?? GATEWAY_LOG_MAX_PAGE_SIZE
        const logs = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...gatewayLogsSpec(args.gatewayId, page, perPage, args.filters ?? []),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The stored body.',
          properties: {
            body: {
              type: 'json',
              required: true,
              description: 'The request or response body as stored by the gateway.',
            },
          },
        },
        render: (_args, value) => json(value.body),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const body = await cf.accountRequest<JsonValue>({
          ...gatewayLogBodySpec(args.gatewayId, args.logId, args.part),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Dynamic routes.',
          properties: {
            routes: {
              type: 'array',
              required: true,
              description: 'Route records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.routes.length, 'route', value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const routes = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...gatewayRouteListSpec(args.gatewayId),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The requested billing view.',
          properties: {
            view: {
              type: 'string',
              required: true,
              description: 'Which billing view was read.',
              enum: BILLING_VIEWS,
            },
            billing: {
              type: 'json',
              required: true,
              description: 'The billing payload as the API returns it.',
            },
          },
        },
        render: (_args, value) => json(value.billing),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const billing = await cf.accountRequest<JsonValue>({
          ...gatewayBillingSpec(args.view),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Matching chunks.',
          properties: {
            results: { type: 'json', required: true, description: 'Search results as the API returns them.' },
          },
        },
        render: (_args, value) => json(value.results),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const results = await cf.accountRequest<JsonValue>({
          ...aiSearchSearchSpec(args.instanceId, args.query, args.maxResults ?? config.searchMaxResults),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The grounded answer.',
          properties: {
            answer: {
              type: 'json',
              required: true,
              description: 'The answer payload as the API returns it.',
            },
          },
        },
        render: (_args, value) => json(value.answer),
      },
      timeoutMs: config.inferenceTimeoutMs,
      async execute(args, exec) {
        const answer = await cf.accountRequest<JsonValue>({
          ...aiSearchChatSpec(args.instanceId, args.query, args.model),
          signal: exec.signal,
          timeoutMs: config.inferenceTimeoutMs,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The sync job that was started.',
          properties: {
            job: { type: 'json', required: true, description: 'The job record as the API returns it.' },
          },
        },
        render: (_args, value) => json(value.job),
      },
      async execute(args, exec) {
        const job = await cf.accountRequest<JsonValue>({
          ...aiSearchSyncSpec(args.instanceId),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Vector indexes in the account.',
          properties: {
            indexes: {
              type: 'array',
              required: true,
              description: 'Index records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.indexes.length, 'index', value),
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const indexes = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...vectorizeIndexListSpec(),
          signal: exec.signal,
        })
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
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Nearest matches.',
          properties: {
            matches: { type: 'json', required: true, description: 'The query result as the API returns it.' },
          },
        },
        render: (_args, value) => json(value.matches),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const matches = await cf.accountRequest<JsonValue>({
          ...vectorizeQuerySpec(
            args.indexName,
            args.vector,
            args.topK ?? config.vectorTopK,
            args.returnValues ?? false,
            args.returnMetadata ?? true,
          ),
          signal: exec.signal,
        })
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
          additionalProperties: false,
          description:
            'Request count, total cost, tokens, and cache hits for the session, plus how far the scan reached.',
          properties: {
            requests: {
              type: 'integer',
              required: true,
              description: 'Log entries that carried the session id.',
            },
            cost: {
              type: 'number',
              required: true,
              description: 'Sum of the cost field over those entries.',
            },
            tokensIn: { type: 'number', required: true, description: 'Sum of tokens_in over those entries.' },
            tokensOut: {
              type: 'number',
              required: true,
              description: 'Sum of tokens_out over those entries.',
            },
            cached: {
              type: 'integer',
              required: true,
              description: 'Entries the gateway served from cache.',
            },
            scanned: {
              type: 'integer',
              required: true,
              description: 'Log entries read across every page, matched or not.',
            },
            pages: { type: 'integer', required: true, description: 'Pages read.' },
            truncated: {
              type: 'boolean',
              required: true,
              description: 'Whether the page ceiling stopped the scan before the last page.',
            },
          },
        },
        render: (args, value) => {
          const partial = value.truncated ? ' (partial: the page ceiling stopped the scan)' : ''
          return text(
            `Session ${args.sessionId}: ${value.requests} requests, ${value.cached} served from cache, cost ${value.cost}${partial}.`,
          )
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const perPage = args.perPage ?? GATEWAY_LOG_MAX_PAGE_SIZE
        const walk = await cf.accountListAll<Record<string, JsonValue>>(
          {
            ...gatewayLogsSpec(
              args.gatewayId,
              1,
              perPage,
              sessionLogFilters(args.sessionId, SESSION_METADATA_KEY),
            ),
            signal: exec.signal,
          },
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
function numericField(log: Record<string, JsonValue>, field: 'cost' | 'tokens_in' | 'tokens_out'): number {
  const value = log[field]
  if (value === undefined) return 0
  // `cost += "0.004"` concatenates and turns the running total into a string.
  // A decimal returned as a string is a plausible API shape, so it is rejected
  // rather than added. `Number.isFinite` does not coerce, so it rejects every
  // non-number as well as NaN and the infinities — no separate `typeof` arm.
  if (!isFiniteNumber(value)) throw new GatewayLogShapeError(field, value)
  return value
}

/**
 * The session id a log entry actually carries.
 *
 * The API returns `metadata` as a JSON string, so this parses it rather than
 * trusting the server-side filter to have been applied.
 */
export function sessionOf(entry: Record<string, JsonValue>): string | undefined {
  // No separate string guard: `JSON.parse` coerces its argument, and every
  // non-string value either fails to parse or fails the object check below, so
  // a guard would be a branch nothing could observe.
  const parsed = parseJson<unknown>(String(entry.metadata))
  // Anything but an object — `null`, a number, a string — carries no session
  // id; the predicate also types the read.
  if (!parsed.ok || !isObject(parsed.value)) return undefined
  const value = parsed.value[SESSION_METADATA_KEY]
  return typeof value === 'string' ? value : undefined
}

/**
 * Reduce gateway log entries to a session summary.
 *
 * Pure, so the arithmetic is unit-testable without a gateway; missing fields
 * count as zero because Cloudflare omits them for some providers.
 */
export function summariseSessionLogs(logs: readonly Record<string, JsonValue>[]): {
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
  for (const log of logs) {
    cost += numericField(log, 'cost')
    tokensIn += numericField(log, 'tokens_in')
    tokensOut += numericField(log, 'tokens_out')
    if (log.cached === true) cached += 1
  }
  return { requests: logs.length, cost, tokensIn, tokensOut, cached }
}

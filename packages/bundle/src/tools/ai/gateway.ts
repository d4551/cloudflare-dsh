/**
 * AI Gateway administration tools: gateways, their logs and bodies, routing
 * rules, and billing views.
 *
 * Registration only. Every path, query and body decision lives in
 * `../../specs/ai.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  GATEWAY_LOG_FILTER_KEYS,
  GATEWAY_LOG_FILTER_OPERATORS,
  GATEWAY_LOG_MAX_PAGE_SIZE,
  GATEWAY_LOG_MIN_PAGE_SIZE,
  type BillingView,
  gatewayBillingSpec,
  gatewayGetSpec,
  gatewayListSpec,
  gatewayLogBodySpec,
  gatewayLogsSpec,
  gatewayRouteListSpec,
} from '../../specs/ai.ts'
import {
  NO_TOTAL_PAGE_OUTCOME_PROPERTIES,
  PAGE_OUTCOME_PROPERTIES,
  PAGE_PARAMETER,
  pageNote,
  pageOutcome,
  requestedPage,
  shortPageOutcome,
} from '../_shared/paging.ts'
import { type JsonValue } from '../_shared/json.ts'
import { apiRecords, json, listing } from '../_shared/render.ts'
import type { AiToolsConfig } from './config.ts'

/** Billing views the cost tool exposes. */
const BILLING_VIEWS: readonly BillingView[] = ['credit-balance', 'usage-history', 'invoice-preview']

/** Register the AI Gateway administration tools on the harness tool registry. */
export function registerGateway(ctx: Context, cf: CloudflareService, config: AiToolsConfig): void {
  ctx.tools.register(
    defineTool({
      name: 'cloudflare_aigateway_list',
      description:
        'List the AI Gateways in the Cloudflare account, one page at a time. The endpoint reports no total, so a full page means more may follow.',
      parameters: {
        ...PAGE_PARAMETER,
        perPage: { type: 'integer', description: `Gateways per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of gateways, and where it sits in the whole.',
          properties: {
            gateways: apiRecords('Gateway'),
            ...PAGE_OUTCOME_PROPERTIES,
          },
        },
        render: (_args, value) => listing(value.gateways.length, 'gateway', value, pageNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = requestedPage(args.page)
        const perPage = args.perPage ?? config.pageSize
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...gatewayListSpec(page, perPage),
          signal: exec.signal,
        })
        return {
          gateways: envelope.result,
          ...pageOutcome(envelope.result_info, page, perPage, envelope.result.length),
        }
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
        ...PAGE_PARAMETER,
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
            logs: apiRecords('Log entry'),
            ...NO_TOTAL_PAGE_OUTCOME_PROPERTIES,
          },
        },
        render: (_args, value) => listing(value.logs.length, 'log entry', value),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        // `requestedPage`, like every other page-numbered tool: this one read
        // `args.page ?? 1` and put `page=0` on the wire while its four siblings
        // refused it.
        const page = requestedPage(args.page)
        const perPage = args.perPage ?? GATEWAY_LOG_MAX_PAGE_SIZE
        const logs = await cf.accountRequest<Record<string, JsonValue>[]>({
          ...gatewayLogsSpec(args.gatewayId, page, perPage, args.filters ?? []),
          signal: exec.signal,
        })
        return { logs, ...shortPageOutcome(page, perPage, logs.length) }
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
            routes: apiRecords('Route'),
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
}

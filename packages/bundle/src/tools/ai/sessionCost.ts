/**
 * The per-session gateway cost tool.
 *
 * The gateway tools are what make the model provider (see `../../ai/`)
 * legible: once requests carry a session id in `cf-aig-metadata`, this reads
 * back the cost, cache behaviour and token volume for that exact session.
 */
import { nextPageQuery } from '@d4551/dsh-cloudflare-core'
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SESSION_METADATA_KEY } from '../../ai/headers.ts'
import { gatewayLogsSpec, GATEWAY_LOG_MAX_PAGE_SIZE, GATEWAY_LOG_MIN_PAGE_SIZE, sessionLogFilters } from '../../specs/ai.ts'
import { type JsonValue } from '../_shared/json.ts'
import { text } from '../_shared/render.ts'
import { sessionOf, summariseSessionLogs } from './session.ts'

/** Register the session cost tool on the harness tool registry. */
export function registerSessionCost(ctx: Context, cf: CloudflareService): void {
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
        // The client's usage chip renders exactly these five figures, and the
        // one-line summary the model reads carries only three of them.
        presentationMeta: (_args, value) => ({
          requests: value.requests,
          cost: value.cost,
          tokensIn: value.tokensIn,
          tokensOut: value.tokensOut,
          cached: value.cached,
        }),
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

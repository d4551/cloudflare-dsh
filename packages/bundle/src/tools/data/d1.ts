/**
 * D1 tools: database listing and SQL execution.
 *
 * Registration only. Every path and body decision lives in
 * `../../specs/data.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { d1ListSpec, d1QuerySpec } from '../../specs/data.ts'
import { PAGE_OUTCOME_PROPERTIES, pageNote, pageOutcome, requestedPage } from '../_shared/paging.ts'
import { type JsonValue } from '../_shared/json.ts'
import { apiRecords, listing, truncatedJson } from '../_shared/render.ts'
import type { DataToolsConfig } from './config.ts'

/** Register the D1 tools on the harness tool registry. */
export function registerD1(ctx: Context, cf: CloudflareService, config: DataToolsConfig): void {
  ctx.tools.register(
    defineTool({
      name: 'cloudflare_d1_list',
      description:
        'List the D1 databases in the Cloudflare account, one page at a time. Returns the total and whether this page is the last.',
      parameters: {
        page: { type: 'integer', description: 'Page number, from 1; the first page when omitted.' },
        perPage: { type: 'integer', description: `Databases per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of D1 databases, and where it sits in the whole.',
          properties: {
            databases: apiRecords('Database'),
            ...PAGE_OUTCOME_PROPERTIES,
          },
        },
        render: (_args, value) => listing(value.databases.length, 'database', value, pageNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = requestedPage(args.page)
        const perPage = args.perPage ?? config.pageSize
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...d1ListSpec(page, perPage),
          signal: exec.signal,
        })
        return {
          databases: envelope.result,
          ...pageOutcome(envelope.result_info, page, perPage, envelope.result.length),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_d1_query',
      description:
        'Run SQL against a D1 database. Handles multi-statement SQL. Use params for bound values rather than string interpolation.',
      parameters: {
        databaseId: { type: 'string', required: true, description: 'D1 database id.' },
        sql: { type: 'string', required: true, description: 'SQL to execute.' },
        params: {
          type: 'array',
          description: 'Bound parameters for ? placeholders.',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Query results.',
          properties: {
            results: { type: 'json', required: true, description: 'Result sets as the API returns them.' },
          },
        },
        // Bounded: a wide result set reached the model whole, and `renderLimit`
        // was declared for exactly this and applied to one tool.
        render: (_args, value) => truncatedJson(value, config.renderLimit),
        // The client's table needs the query beside its rows, and the render
        // text cannot carry the rows losslessly. Persisted with the session
        // log, so a replayed call renders the same table as a live one.
        presentationMeta: (args, value) => ({ sql: args.sql, resultSets: value.results }),
      },
      async execute(args, exec) {
        const results = await cf.accountRequest<JsonValue>({
          ...d1QuerySpec(args.databaseId, args.sql, args.params ?? []),
          signal: exec.signal,
        })
        return { results }
      },
    }),
  )
}

/**
 * AI Search (formerly AutoRAG) tools: search, grounded chat, and sync.
 *
 * Registration only. Every path and body decision lives in
 * `../../specs/ai.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { aiSearchChatSpec, aiSearchSearchSpec, aiSearchSyncSpec } from '../../specs/ai.ts'
import { type JsonValue } from '../_shared/json.ts'
import { json } from '../_shared/render.ts'
import type { AiToolsConfig } from './config.ts'

/** Register the AI Search tools on the harness tool registry. */
export function registerAiSearch(ctx: Context, cf: CloudflareService, config: AiToolsConfig): void {
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
}

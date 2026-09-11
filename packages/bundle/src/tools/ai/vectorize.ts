/**
 * Vectorize tools: index listing, query, upsert, delete by id, read by id.
 *
 * Registration only. Every path and body decision lives in
 * `../../specs/ai.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  UNPARSABLE_BEHAVIORS,
  VECTORIZE_METADATA_MODES,
  vectorizeDeleteByIdsSpec,
  vectorizeGetByIdsSpec,
  vectorizeIndexListSpec,
  vectorizeQuerySpec,
  vectorizeWriteSpec,
} from '../../specs/ai.ts'
import { EmptyBatchError } from '../_shared/batch.ts'
import { type JsonValue } from '../_shared/json.ts'
import { apiRecords, json, listing, plural, text } from '../_shared/render.ts'
import type { AiToolsConfig } from './config.ts'

/** Register the Vectorize tools on the harness tool registry. */
export function registerVectorize(ctx: Context, cf: CloudflareService, config: AiToolsConfig): void {
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
            indexes: apiRecords('Index'),
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
        returnMetadata: {
          type: 'string',
          enum: VECTORIZE_METADATA_MODES,
          description:
            'How much stored metadata to return: none, only the indexed fields, or all of it. Defaults to all.',
        },
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
            args.returnMetadata ?? 'all',
          ),
          signal: exec.signal,
        })
        return { matches }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_vectorize_upsert',
      description:
        'Write vectors to a Vectorize index. upsert replaces a vector that already carries the id; insert leaves it alone and reports the id as a duplicate.',
      parameters: {
        indexName: { type: 'string', required: true, description: 'Index name.' },
        vectors: {
          type: 'array',
          required: true,
          description: 'Vectors to write.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true, description: 'Vector identifier.' },
              values: {
                type: 'array',
                required: true,
                description: 'The vector itself; its length must match the index dimensions.',
                items: { type: 'number' },
              },
              metadata: { type: 'json', description: 'Metadata stored beside the vector.' },
            },
          },
        },
        mode: {
          type: 'string',
          enum: ['upsert', 'insert'],
          description: 'upsert (default) overwrites an existing id; insert refuses it.',
        },
        unparsableBehavior: {
          type: 'string',
          enum: UNPARSABLE_BEHAVIORS,
          description: 'What to do with a vector the API cannot parse: error (default) or discard.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'What the write reported.',
          properties: {
            written: { type: 'integer', required: true, description: 'Vectors sent in the request.' },
            mutation: {
              type: 'json',
              required: true,
              description: 'The mutation record as the API returns it; a write is applied asynchronously.',
            },
          },
        },
        render: (_args, value) => [
          ...text(`Sent ${plural(value.written, 'vector')}.`),
          ...json(value.mutation),
        ],
      },
      async execute(args, exec) {
        const vectors = args.vectors
        if (vectors.length === 0) throw new EmptyBatchError('vectors')
        const mutation = await cf.accountRequest<JsonValue>({
          ...vectorizeWriteSpec(
            args.indexName,
            args.mode ?? 'upsert',
            vectors,
            args.unparsableBehavior ?? 'error',
          ),
          signal: exec.signal,
        })
        return { written: vectors.length, mutation }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_vectorize_delete',
      description: 'Delete vectors from a Vectorize index by id.',
      parameters: {
        indexName: { type: 'string', required: true, description: 'Index name.' },
        ids: {
          type: 'array',
          required: true,
          description: 'Vector identifiers to delete.',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'What the deletion reported.',
          properties: {
            requested: { type: 'integer', required: true, description: 'Identifiers in the request.' },
            mutation: {
              type: 'json',
              required: true,
              description: 'The mutation record as the API returns it; a deletion is applied asynchronously.',
            },
          },
        },
        render: (_args, value) => [
          ...text(`Asked to delete ${plural(value.requested, 'vector')}.`),
          ...json(value.mutation),
        ],
      },
      async execute(args, exec) {
        const ids = args.ids
        if (ids.length === 0) throw new EmptyBatchError('ids')
        const mutation = await cf.accountRequest<JsonValue>({
          ...vectorizeDeleteByIdsSpec(args.indexName, ids),
          signal: exec.signal,
        })
        return { requested: ids.length, mutation }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_vectorize_get',
      description: 'Read vectors back from a Vectorize index by id.',
      parameters: {
        indexName: { type: 'string', required: true, description: 'Index name.' },
        ids: {
          type: 'array',
          required: true,
          description: 'Vector identifiers to read.',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The vectors the index holds for those identifiers.',
          properties: {
            vectors: {
              type: 'json',
              required: true,
              description: 'The vectors as the API returns them; an unknown id is simply absent.',
            },
          },
        },
        render: (_args, value) => json(value.vectors),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const ids = args.ids
        if (ids.length === 0) throw new EmptyBatchError('ids')
        const vectors = await cf.accountRequest<JsonValue>({
          ...vectorizeGetByIdsSpec(args.indexName, ids),
          signal: exec.signal,
        })
        return { vectors }
      },
    }),
  )
}

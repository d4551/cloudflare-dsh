/**
 * Data-plane tools: Workers KV, D1, Queues, and R2 bucket management.
 *
 * Registration only. Every path, query and body decision lives in
 * `../specs/data.ts` as a pure function, and every rendering decision in
 * `./_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import {
  d1ListSpec,
  d1QuerySpec,
  kvBulkDeleteSpec,
  kvBulkPutSpec,
  kvDeleteSpec,
  kvListKeysSpec,
  kvNamespaceListSpec,
  kvValuePath,
  queueAckSpec,
  queueListSpec,
  queuePullSpec,
  queueSendSpec,
  r2BucketCreateSpec,
  r2BucketListSpec,
} from '../specs/data.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, listing, text, truncate } from './_shared/render.ts'

/** Context shape these tools require. */
interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** Longest value body rendered to the model; the canonical value keeps it all. */

export const name = 'cloudflare-tools-data'
export const inject = ['tools', 'cloudflare']

export interface DataToolsConfig {
  /** Default page size for namespace, database, queue and bucket listings. */
  pageSize: number
  /** Default number of keys `cloudflare_kv_list_keys` returns per page. */
  keyListLimit: number
  /** Characters of a KV value shown to the model before truncation. */
  renderLimit: number
  /** Default number of messages `cloudflare_queue_pull` takes. */
  queueBatchSize: number
  /** Default time pulled messages stay invisible to other consumers. */
  queueVisibilityTimeoutMs: number
}

export const Config: Schema<Partial<DataToolsConfig>, DataToolsConfig> = Schema.object({
  pageSize: Schema.natural().min(1).default(50),
  keyListLimit: Schema.natural().min(1).default(1000),
  renderLimit: Schema.natural().min(1).default(4000),
  queueBatchSize: Schema.natural().min(1).default(10),
  queueVisibilityTimeoutMs: Schema.natural().min(1).default(30_000),
})

export function apply(ctx: Context, config: DataToolsConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_namespace_list',
      description: 'List the Workers KV namespaces in the Cloudflare account.',
      parameters: {
        perPage: { type: 'integer', description: `Namespaces per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'KV namespaces in the account.',
          properties: {
            namespaces: {
              type: 'array',
              required: true,
              description: 'Namespace records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.namespaces.length, 'namespace', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const namespaces = await cf.accountRequest<Record<string, JsonValue>[]>(
          kvNamespaceListSpec(args.perPage ?? config.pageSize),
        )
        return { namespaces }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_list_keys',
      description:
        'List keys in a Workers KV namespace. Returns the cursor for the next page and whether the listing is complete.',
      parameters: {
        namespaceId: { type: 'string', required: true, description: 'KV namespace id.' },
        prefix: { type: 'string', description: 'Only list keys starting with this prefix.' },
        limit: { type: 'integer', description: `Maximum keys to return (default ${config.keyListLimit}).` },
        cursor: {
          type: 'string',
          description: 'Cursor returned by a previous page; omit for the first page.',
        },
      },
      output: {
        schema: {
          type: 'object',
          description: 'Keys and paging state.',
          additionalProperties: false,
          properties: {
            keys: {
              type: 'array',
              required: true,
              description: 'Key entries as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
            cursor: {
              type: 'string',
              required: true,
              description: 'Cursor for the next page; empty when complete.',
            },
            complete: {
              type: 'boolean',
              required: true,
              description: 'Whether every key has been returned.',
            },
          },
        },
        render: (_args, value) => listing(value.keys.length, 'key', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        // The envelope, not just its result: `result_info.cursor` is the paging
        // state this tool exists to hand back. The API ends a listing by
        // omitting the cursor (or sending an empty one).
        const page = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>(
          kvListKeysSpec(args.namespaceId, args.prefix, args.limit ?? config.keyListLimit, args.cursor),
        )
        const raw = page.result_info?.cursor
        if (raw !== undefined && typeof raw !== 'string') {
          throw new TypeError(`KV result_info.cursor must be a string, got ${typeof raw}`)
        }
        const cursor = raw ?? ''
        return { keys: page.result, cursor, complete: cursor === '' }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_get',
      description: 'Read one key from a Workers KV namespace. Returns the stored value as text.',
      parameters: {
        namespaceId: { type: 'string', required: true, description: 'KV namespace id.' },
        key: { type: 'string', required: true, description: 'Key to read.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The key and its stored value.',
          properties: {
            key: { type: 'string', required: true, description: 'The key that was read.' },
            value: { type: 'string', required: true, description: 'The stored value, verbatim.' },
          },
        },
        render: (args, value) => text(`${args.key}\n${truncate(value.value, config.renderLimit)}`),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const value = await cf.accountRequestText({
          method: 'GET',
          path: kvValuePath(args.namespaceId, args.key),
        })
        return { key: args.key, value }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_put',
      description: 'Write one or more key/value pairs to a Workers KV namespace. Values are stored as text.',
      parameters: {
        namespaceId: { type: 'string', required: true, description: 'KV namespace id.' },
        entries: {
          type: 'array',
          required: true,
          description: 'Key/value pairs to write.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: { type: 'string', required: true },
              value: { type: 'string', required: true },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'How many pairs were written.',
          properties: {
            written: { type: 'integer', required: true, description: 'Key/value pairs written.' },
          },
        },
        render: (_args, value) => text(`Wrote ${value.written} key/value pairs.`),
      },
      async execute(args) {
        const entries = args.entries
        await cf.accountRequest<JsonValue>(kvBulkPutSpec(args.namespaceId, entries))
        return { written: entries.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_delete',
      description: 'Delete one key, or several keys, from a Workers KV namespace.',
      parameters: {
        namespaceId: { type: 'string', required: true, description: 'KV namespace id.' },
        keys: {
          type: 'array',
          required: true,
          description: 'Keys to delete.',
          items: { type: 'string' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'How many keys were deleted.',
          properties: { deleted: { type: 'integer', required: true, description: 'Keys deleted.' } },
        },
        render: (_args, value) => text(`Deleted ${value.deleted} keys.`),
      },
      async execute(args) {
        const keys = args.keys
        const spec =
          keys.length === 1
            ? kvDeleteSpec(args.namespaceId, keys[0]!)
            : kvBulkDeleteSpec(args.namespaceId, keys)
        await cf.accountRequest<JsonValue>(spec)
        return { deleted: keys.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_d1_list',
      description: 'List the D1 databases in the Cloudflare account.',
      parameters: {
        perPage: { type: 'integer', description: `Databases per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'D1 databases in the account.',
          properties: {
            databases: {
              type: 'array',
              required: true,
              description: 'Database records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.databases.length, 'database', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const databases = await cf.accountRequest<Record<string, JsonValue>[]>(
          d1ListSpec(args.perPage ?? config.pageSize),
        )
        return { databases }
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
        render: (_args, value) => json(value),
      },
      async execute(args) {
        const results = await cf.accountRequest<JsonValue>(
          d1QuerySpec(args.databaseId, args.sql, args.params ?? []),
        )
        return { results }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_list',
      description: 'List the Cloudflare Queues in the account.',
      parameters: {
        perPage: { type: 'integer', description: `Queues per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Queues in the account.',
          properties: {
            queues: {
              type: 'array',
              required: true,
              description: 'Queue records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.queues.length, 'queue', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const queues = await cf.accountRequest<Record<string, JsonValue>[]>(
          queueListSpec(args.perPage ?? config.pageSize),
        )
        return { queues }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_send',
      description: 'Push one message onto a Cloudflare Queue.',
      parameters: {
        queueId: { type: 'string', required: true, description: 'Queue id.' },
        body: { type: 'json', required: true, description: 'Message payload.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Confirmation that the message was queued.',
          properties: {
            queued: {
              type: 'boolean',
              required: true,
              description: 'Always true once the API accepted the message.',
            },
          },
        },
        render: () => text('Message queued.'),
      },
      async execute(args) {
        await cf.accountRequest<JsonValue>(queueSendSpec(args.queueId, args.body))
        return { queued: true }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_pull',
      description:
        'Pull a batch of messages from a Cloudflare Queue. Each message carries a lease_id that must be passed to cloudflare_queue_ack.',
      parameters: {
        queueId: { type: 'string', required: true, description: 'Queue id.' },
        batchSize: { type: 'integer', description: `Messages to pull (default ${config.queueBatchSize}).` },
        visibilityTimeoutMs: {
          type: 'integer',
          description: `How long pulled messages stay invisible, in ms (default ${config.queueVisibilityTimeoutMs}, max 12 hours).`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'Pulled messages.',
          properties: {
            messages: {
              type: 'array',
              required: true,
              description: 'Messages as the API returns them, each with its lease id.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.messages.length, 'message', value),
      },
      async execute(args) {
        const result = await cf.accountRequest<{ messages?: Record<string, JsonValue>[] }>(
          queuePullSpec(
            args.queueId,
            args.batchSize ?? config.queueBatchSize,
            args.visibilityTimeoutMs ?? config.queueVisibilityTimeoutMs,
          ),
        )
        return { messages: result.messages ?? [] }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_ack',
      description:
        'Acknowledge or retry messages pulled from a Cloudflare Queue, by lease id. Acknowledged messages are removed; retried messages become visible again.',
      parameters: {
        queueId: { type: 'string', required: true, description: 'Queue id.' },
        acks: { type: 'array', description: 'Lease ids to acknowledge.', items: { type: 'string' } },
        retries: { type: 'array', description: 'Lease ids to retry.', items: { type: 'string' } },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'How many leases were settled.',
          properties: {
            acked: { type: 'integer', required: true, description: 'Leases acknowledged.' },
            retried: { type: 'integer', required: true, description: 'Leases returned for retry.' },
          },
        },
        render: (_args, value) => {
          return text(`Acknowledged ${value.acked}, retried ${value.retried}.`)
        },
      },
      async execute(args) {
        const acks = args.acks ?? []
        const retries = args.retries ?? []
        await cf.accountRequest<JsonValue>(queueAckSpec(args.queueId, acks, retries))
        return { acked: acks.length, retried: retries.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_list',
      description: 'List the R2 buckets in the Cloudflare account.',
      parameters: {
        perPage: { type: 'integer', description: `Buckets per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'R2 buckets in the account.',
          properties: {
            buckets: {
              type: 'array',
              required: true,
              description: 'Bucket records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
          },
        },
        render: (_args, value) => listing(value.buckets.length, 'bucket', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const result = await cf.accountRequest<{ buckets?: Record<string, JsonValue>[] }>(
          r2BucketListSpec(args.perPage ?? config.pageSize),
        )
        return { buckets: result.buckets ?? [] }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_create',
      description: 'Create an R2 bucket.',
      parameters: {
        name: { type: 'string', required: true, description: 'Bucket name.' },
        locationHint: {
          type: 'string',
          description: 'Preferred region hint, e.g. wnam, enam, weur, eeur, apac.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The bucket that was created.',
          properties: {
            bucket: { type: 'json', required: true, description: 'The bucket record as the API returns it.' },
          },
        },
        render: (args) => text(`Created R2 bucket ${args.name}.`),
      },
      async execute(args) {
        const bucket = await cf.accountRequest<JsonValue>(r2BucketCreateSpec(args.name, args.locationHint))
        return { bucket }
      },
    }),
  )
}

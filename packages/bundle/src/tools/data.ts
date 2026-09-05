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
const RENDER_LIMIT = 4000

export const name = 'cloudflare-tools-data'
export const inject = ['tools', 'cloudflare']

export function apply(ctx: Context): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_namespace_list',
      description: 'List the Workers KV namespaces in the Cloudflare account.',
      parameters: {
        perPage: { type: 'integer', description: 'Namespaces per page (default 50).' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          description: 'Namespaces with their ids and titles.',
        },
        render: (_args, value) => listing((value as { namespaces: unknown[] }).namespaces.length, 'namespace', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const namespaces = await cf.accountRequest<JsonValue[]>(kvNamespaceListSpec(args.perPage ?? 50))
        return { namespaces }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_kv_list_keys',
      description:
        'List keys in a Workers KV namespace. Returns a cursor for paging when more keys remain.',
      parameters: {
        namespaceId: { type: 'string', required: true, description: 'KV namespace id.' },
        prefix: { type: 'string', description: 'Only list keys starting with this prefix.' },
        limit: { type: 'integer', description: 'Maximum keys to return (default 1000).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Keys and paging state.' },
        render: (_args, value) => listing((value as { keys: unknown[] }).keys.length, 'key', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const keys = await cf.accountRequest<JsonValue[]>(
          kvListKeysSpec(args.namespaceId, args.prefix, args.limit ?? 1000),
        )
        return { keys }
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
        schema: { type: 'object', additionalProperties: true, description: 'The stored value.' },
        render: (args, value) =>
          text(`${args.key}\n${truncate((value as { value: string }).value, RENDER_LIMIT)}`),
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
      description:
        'Write one or more key/value pairs to a Workers KV namespace. Values are stored as text.',
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
        schema: { type: 'object', additionalProperties: true, description: 'How many pairs were written.' },
        render: (_args, value) => text(`Wrote ${(value as { written: number }).written} key/value pairs.`),
      },
      async execute(args) {
        const entries = args.entries as readonly { key: string; value: string }[]
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
        schema: { type: 'object', additionalProperties: true, description: 'How many keys were deleted.' },
        render: (_args, value) => text(`Deleted ${(value as { deleted: number }).deleted} keys.`),
      },
      async execute(args) {
        const keys = args.keys as readonly string[]
        const spec = keys.length === 1 ? kvDeleteSpec(args.namespaceId, keys[0]!) : kvBulkDeleteSpec(args.namespaceId, keys)
        await cf.accountRequest<JsonValue>(spec)
        return { deleted: keys.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_d1_list',
      description: 'List the D1 databases in the Cloudflare account.',
      parameters: { perPage: { type: 'integer', description: 'Databases per page (default 50).' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Databases with ids and names.' },
        render: (_args, value) => listing((value as { databases: unknown[] }).databases.length, 'database', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const databases = await cf.accountRequest<JsonValue[]>(d1ListSpec(args.perPage ?? 50))
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
        schema: { type: 'object', additionalProperties: true, description: 'Result sets with rows and metadata.' },
        render: (_args, value) => json(value),
      },
      async execute(args) {
        const results = await cf.accountRequest<JsonValue>(
          d1QuerySpec(args.databaseId, args.sql, (args.params ?? []) as readonly string[]),
        )
        return { results }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_list',
      description: 'List the Cloudflare Queues in the account.',
      parameters: { perPage: { type: 'integer', description: 'Queues per page (default 50).' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Queues with ids and names.' },
        render: (_args, value) => listing((value as { queues: unknown[] }).queues.length, 'queue', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const queues = await cf.accountRequest<JsonValue[]>(queueListSpec(args.perPage ?? 50))
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
        schema: { type: 'object', additionalProperties: true, description: 'Send acknowledgement.' },
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
        batchSize: { type: 'integer', description: 'Messages to pull (default 10).' },
        visibilityTimeoutMs: {
          type: 'integer',
          description: 'How long pulled messages stay invisible, in ms (default 30000, max 12 hours).',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Pulled messages with lease ids.' },
        render: (_args, value) => listing((value as { messages: unknown[] }).messages.length, 'message', value),
      },
      async execute(args) {
        const result = await cf.accountRequest<{ messages?: JsonValue[] }>(
          queuePullSpec(args.queueId, args.batchSize ?? 10, args.visibilityTimeoutMs ?? 30_000),
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
        schema: { type: 'object', additionalProperties: true, description: 'Counts acknowledged and retried.' },
        render: (_args, value) => {
          const v = value as { acked: number; retried: number }
          return text(`Acknowledged ${v.acked}, retried ${v.retried}.`)
        },
      },
      async execute(args) {
        const acks = (args.acks ?? []) as readonly string[]
        const retries = (args.retries ?? []) as readonly string[]
        await cf.accountRequest<JsonValue>(queueAckSpec(args.queueId, acks, retries))
        return { acked: acks.length, retried: retries.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_list',
      description: 'List the R2 buckets in the Cloudflare account.',
      parameters: { perPage: { type: 'integer', description: 'Buckets per page (default 50).' } },
      output: {
        schema: { type: 'object', additionalProperties: true, description: 'Buckets with names and creation dates.' },
        render: (_args, value) => listing((value as { buckets: unknown[] }).buckets.length, 'bucket', value),
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        const result = await cf.accountRequest<{ buckets?: JsonValue[] }>(r2BucketListSpec(args.perPage ?? 50))
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
        schema: { type: 'object', additionalProperties: true, description: 'The created bucket.' },
        render: (args) => text(`Created R2 bucket ${args.name}.`),
      },
      async execute(args) {
        const bucket = await cf.accountRequest<JsonValue>(r2BucketCreateSpec(args.name, args.locationHint))
        return { bucket }
      },
    }),
  )
}

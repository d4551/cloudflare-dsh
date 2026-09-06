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
import { isInteger, isObject, isStringArray, type JsonValue } from './_shared/json.ts'
import {
  PAGE_OUTCOME_PROPERTIES,
  cursorNote,
  cursorOutcome,
  pageNote,
  pageOutcome,
  requestedPage,
  wholeListNote,
  wholeListOutcome,
} from './_shared/paging.ts'
import { json, listing, plural, text, truncate } from './_shared/render.ts'

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

/**
 * The per-key outcome a KV bulk endpoint may report. Cloudflare's result
 * schema (`workers-kv_bulk-result`) declares both fields optional and its SDK
 * types the whole result as nullable, so an acknowledgement can arrive with a
 * count, with a count and the failed keys, or with nothing at all. A field is
 * `null` here exactly when the API did not send it.
 */
interface KvBulkOutcome {
  readonly count: number | null
  readonly failed: string[] | null
}

/** Raised when a KV bulk result is not the shape Cloudflare declares for it. */
export class KvBulkResultShapeError extends TypeError {
  override readonly name = 'KvBulkResultShapeError'
  constructor(problem: string) {
    super(`the KV bulk result is not the shape Cloudflare declares: ${problem}`)
  }
}

/**
 * Project a KV bulk result field by field. A `null` result is a bare
 * acknowledgement; a present field of the wrong type is a malformed response
 * and fails loudly. Neither becomes a count taken from the request, which is
 * the lie this projection exists to avoid.
 */
function kvBulkOutcome(result: JsonValue): KvBulkOutcome {
  if (result === null) return { count: null, failed: null }
  if (!isObject(result) || Array.isArray(result)) {
    throw new KvBulkResultShapeError('the result is neither an object nor null')
  }
  const count = result.successful_key_count
  const failed = result.unsuccessful_keys
  if (count !== undefined && !isInteger(count)) {
    throw new KvBulkResultShapeError('successful_key_count is not an integer')
  }
  if (failed !== undefined && !isStringArray(failed)) {
    throw new KvBulkResultShapeError('unsuccessful_keys is not an array of strings')
  }
  return { count: count === undefined ? null : count, failed: failed === undefined ? null : failed }
}

/** The count line of a bulk summary: what Cloudflare reported, or that it reported nothing. */
function countLine(verb: 'Wrote' | 'Deleted', requested: number, noun: string, count: number | null): string {
  if (count === null) {
    return `Cloudflare accepted ${plural(requested, noun)} without reporting how many it ${verb.toLowerCase()}.`
  }
  return `${verb} ${count} of ${plural(requested, noun)}.`
}

/** The failed-keys note of a bulk summary; nothing when Cloudflare named none. */
function failedNote(keys: readonly string[] | null): string {
  if (keys === null || keys.length === 0) return ''
  return ` ${plural(keys.length, 'key')} failed and should be retried: ${keys.join(', ')}.`
}

/** Raised when a bulk operation names nothing: the request would do nothing and report success. */
export class EmptyBatchError extends RangeError {
  override readonly name = 'EmptyBatchError'
  constructor(field: string) {
    super(`${field} must name at least one item; an empty request would do nothing`)
  }
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
      description:
        'List the Workers KV namespaces in the Cloudflare account, one page at a time. Returns the total and whether this page is the last.',
      parameters: {
        page: { type: 'integer', description: 'Page number, from 1; the first page when omitted.' },
        perPage: { type: 'integer', description: `Namespaces per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of KV namespaces, and where it sits in the whole.',
          properties: {
            namespaces: {
              type: 'array',
              required: true,
              description: 'Namespace records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
            ...PAGE_OUTCOME_PROPERTIES,
          },
        },
        render: (_args, value) => listing(value.namespaces.length, 'namespace', value, pageNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = requestedPage(args.page)
        const perPage = args.perPage ?? config.pageSize
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...kvNamespaceListSpec(page, perPage),
          signal: exec.signal,
        })
        return {
          namespaces: envelope.result,
          ...pageOutcome(envelope.result_info, page, perPage, envelope.result.length),
        }
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
        render: (_args, value) => listing(value.keys.length, 'key', value, cursorNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        // The envelope, not just its result: `result_info.cursor` is the paging
        // state this tool exists to hand back. The API ends a listing by
        // omitting the cursor (or sending an empty one).
        const page = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...kvListKeysSpec(args.namespaceId, args.prefix, args.limit ?? config.keyListLimit, args.cursor),
          signal: exec.signal,
        })
        return { keys: page.result, ...cursorOutcome(page.result_info) }
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
      async execute(args, exec) {
        const value = await cf.accountRequestText({
          signal: exec.signal,
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
          description: 'What Cloudflare reported about the write.',
          properties: {
            requested: { type: 'integer', required: true, description: 'Key/value pairs in the request.' },
            written: {
              oneOf: [{ type: 'integer' }, { type: 'null' }],
              required: true,
              description: 'Pairs Cloudflare reports written; null when it reported no count.',
            },
            failed: {
              oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
              required: true,
              description:
                'Keys Cloudflare reports as not written, to be retried; null when the response carried no such list.',
            },
          },
        },
        render: (_args, value) =>
          text(
            `${countLine('Wrote', value.requested, 'key/value pair', value.written)}${failedNote(value.failed)}`,
          ),
      },
      async execute(args, exec) {
        const entries = args.entries
        if (entries.length === 0) throw new EmptyBatchError('entries')
        // What was written comes from the API's answer, never from the size
        // of the request.
        const outcome = kvBulkOutcome(
          await cf.accountRequest<JsonValue>({
            ...kvBulkPutSpec(args.namespaceId, entries),
            signal: exec.signal,
          }),
        )
        return { requested: entries.length, written: outcome.count, failed: outcome.failed }
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
          description: 'What Cloudflare reported about the deletion.',
          properties: {
            requested: { type: 'integer', required: true, description: 'Keys in the request.' },
            deleted: {
              oneOf: [{ type: 'integer' }, { type: 'null' }],
              required: true,
              description: 'Keys Cloudflare reports deleted; null when it reported no count.',
            },
            failed: {
              oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
              required: true,
              description:
                'Keys Cloudflare reports as not deleted, to be retried; null when the response carried no such list.',
            },
          },
        },
        render: (_args, value) =>
          text(`${countLine('Deleted', value.requested, 'key', value.deleted)}${failedNote(value.failed)}`),
      },
      async execute(args, exec) {
        const keys = args.keys
        if (keys.length === 0) throw new EmptyBatchError('keys')
        // Always the bulk endpoint, even for one key: it is the one whose answer
        // can carry the outcome.
        const outcome = kvBulkOutcome(
          await cf.accountRequest<JsonValue>({
            ...kvBulkDeleteSpec(args.namespaceId, keys),
            signal: exec.signal,
          }),
        )
        return { requested: keys.length, deleted: outcome.count, failed: outcome.failed }
      },
    }),
  )

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
            databases: {
              type: 'array',
              required: true,
              description: 'Database records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
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
        render: (_args, value) => json(value),
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

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_queue_list',
      description:
        'List the Cloudflare Queues in the account. The endpoint takes no paging parameters, so this is the whole listing; the result says if the API reported more than it returned.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The queues in the account, and whether the API reported more than it returned.',
          properties: {
            queues: {
              type: 'array',
              required: true,
              description: 'Queue records as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
            total: {
              oneOf: [{ type: 'integer' }, { type: 'null' }],
              required: true,
              description: 'Queues the API says exist in all; null when it did not say.',
            },
            complete: {
              type: 'boolean',
              required: true,
              description: 'Whether every queue the API reported was returned.',
            },
          },
        },
        render: (_args, value) => listing(value.queues.length, 'queue', value, wholeListNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...queueListSpec(),
          signal: exec.signal,
        })
        return { queues: envelope.result, ...wholeListOutcome(envelope.result_info, envelope.result.length) }
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
      async execute(args, exec) {
        await cf.accountRequest<JsonValue>({ ...queueSendSpec(args.queueId, args.body), signal: exec.signal })
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
      async execute(args, exec) {
        const result = await cf.accountRequest<{ messages?: Record<string, JsonValue>[] }>({
          ...queuePullSpec(
            args.queueId,
            args.batchSize ?? config.queueBatchSize,
            args.visibilityTimeoutMs ?? config.queueVisibilityTimeoutMs,
          ),
          signal: exec.signal,
        })
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
      async execute(args, exec) {
        const acks = args.acks ?? []
        const retries = args.retries ?? []
        if (acks.length + retries.length === 0) throw new EmptyBatchError('acks or retries')
        await cf.accountRequest<JsonValue>({
          ...queueAckSpec(args.queueId, acks, retries),
          signal: exec.signal,
        })
        return { acked: acks.length, retried: retries.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_list',
      description:
        'List the R2 buckets in the Cloudflare account. Returns the cursor for the next page and whether the listing is complete.',
      parameters: {
        perPage: { type: 'integer', description: `Buckets per page (default ${config.pageSize}).` },
        cursor: {
          type: 'string',
          description: 'Cursor returned by a previous page; omit for the first page.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of R2 buckets and the cursor for the next.',
          properties: {
            buckets: {
              type: 'array',
              required: true,
              description: 'Bucket records as the API returns them.',
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
              description: 'Whether every bucket has been returned.',
            },
          },
        },
        render: (_args, value) => listing(value.buckets.length, 'bucket', value, cursorNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const envelope = await cf.accountRequestEnvelope<{ buckets?: Record<string, JsonValue>[] }>({
          ...r2BucketListSpec(args.perPage ?? config.pageSize, args.cursor),
          signal: exec.signal,
        })
        return { buckets: envelope.result.buckets ?? [], ...cursorOutcome(envelope.result_info) }
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
      async execute(args, exec) {
        const bucket = await cf.accountRequest<JsonValue>({
          ...r2BucketCreateSpec(args.name, args.locationHint),
          signal: exec.signal,
        })
        return { bucket }
      },
    }),
  )
}

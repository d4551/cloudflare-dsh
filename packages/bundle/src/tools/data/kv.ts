/**
 * Workers KV tools: namespace listing, key listing, value reads, and the bulk
 * write and delete whose outcome is projected field by field.
 *
 * Registration only. Every path, query and body decision lives in
 * `../../specs/data.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  kvBulkDeleteSpec,
  kvBulkPutSpec,
  kvListKeysSpec,
  kvNamespaceListSpec,
  kvValuePath,
} from '../../specs/data.ts'
import { EmptyBatchError } from '../_shared/batch.ts'
import { isInteger, isObject, isStringArray, type JsonValue } from '../_shared/json.ts'
import {
  PAGE_OUTCOME_PROPERTIES,
  cursorNote,
  cursorOutcome,
  cursorOutcomeProperties,
  pageNote,
  pageOutcome,
  requestedPage,
} from '../_shared/paging.ts'
import { apiRecords, listing, plural, text, truncate } from '../_shared/render.ts'
import type { DataToolsConfig } from './config.ts'

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

/** Register the Workers KV tools on the harness tool registry. */
export function registerKv(ctx: Context, cf: CloudflareService, config: DataToolsConfig): void {
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
            namespaces: apiRecords('Namespace'),
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
            ...cursorOutcomeProperties('key'),
          },
        },
        render: (_args, value) => listing(value.keys.length, 'key', value, cursorNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        // The envelope, not just its result: `result_info.cursor` is the paging
        // state this tool exists to hand back. The API ends a listing by
        // omitting the cursor (or sending an empty one).
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...kvListKeysSpec(args.namespaceId, args.prefix, args.limit ?? config.keyListLimit, args.cursor),
          signal: exec.signal,
        })
        return { keys: envelope.result, ...cursorOutcome(envelope.result_info) }
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
}

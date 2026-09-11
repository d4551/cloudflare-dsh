/**
 * Cloudflare Queues tools: listing, send, pull, and acknowledge/retry.
 *
 * Registration only. Every path and body decision lives in
 * `../../specs/data.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { queueAckSpec, queueListSpec, queuePullSpec, queueSendSpec } from '../../specs/data.ts'
import { EmptyBatchError } from '../_shared/batch.ts'
import { type JsonValue } from '../_shared/json.ts'
import { wholeListNote, wholeListOutcome } from '../_shared/paging.ts'
import { apiRecords, listing, text } from '../_shared/render.ts'
import type { DataToolsConfig } from './config.ts'

/** Register the Queues tools on the harness tool registry. */
export function registerQueues(ctx: Context, cf: CloudflareService, config: DataToolsConfig): void {
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
            queues: apiRecords('Queue'),
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
}

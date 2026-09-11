import type { ToolContract } from './shared.ts'

/**
 * The queue-ack tool takes a parameter named `retries`, pinned here under a
 * named key so the fixture reads as the schema it mirrors rather than as
 * runner configuration.
 */
const RETRY_LEASES_KEY = 'retries'

/** The contracted surface of the Cloudflare Queues tools. */
export const QUEUE_CONTRACT: Record<string, ToolContract> = {
  cloudflare_queue_ack: {
    description:
      'Acknowledge or retry messages pulled from a Cloudflare Queue, by lease id. Acknowledged messages are removed; retried messages become visible again.',
    parameters: {
      type: 'object',
      properties: {
        queueId: {
          type: 'string',
          description: 'Queue id.',
        },
        acks: {
          type: 'array',
          description: 'Lease ids to acknowledge.',
          items: {
            type: 'string',
          },
        },
        [RETRY_LEASES_KEY]: {
          type: 'array',
          description: 'Lease ids to retry.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['queueId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        acked: {
          type: 'integer',
          description: 'Leases acknowledged.',
        },
        retried: {
          type: 'integer',
          description: 'Leases returned for retry.',
        },
      },
      required: ['acked', 'retried'],
      description: 'How many leases were settled.',
    },
  },
  cloudflare_queue_list: {
    description:
      'List the Cloudflare Queues in the account. The endpoint takes no paging parameters, so this is the whole listing; the result says if the API reported more than it returned.',
    parameters: {
      type: 'object',
      properties: {},
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        queues: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Queue records as the API returns them.',
        },
        total: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Queues the API says exist in all; null when it did not say.',
        },
        complete: {
          type: 'boolean',
          description: 'Whether every queue the API reported was returned.',
        },
      },
      required: ['queues', 'total', 'complete'],
      description: 'The queues in the account, and whether the API reported more than it returned.',
    },
  },
  cloudflare_queue_pull: {
    description:
      'Pull a batch of messages from a Cloudflare Queue. Each message carries a lease_id that must be passed to cloudflare_queue_ack.',
    parameters: {
      type: 'object',
      properties: {
        queueId: {
          type: 'string',
          description: 'Queue id.',
        },
        batchSize: {
          type: 'integer',
          description: 'Messages to pull (default 10).',
        },
        visibilityTimeoutMs: {
          type: 'integer',
          description: 'How long pulled messages stay invisible, in ms (default 30000, max 12 hours).',
        },
      },
      required: ['queueId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Messages as the API returns them, each with its lease id.',
        },
      },
      required: ['messages'],
      description: 'Pulled messages.',
    },
  },
  cloudflare_queue_send: {
    description: 'Push one message onto a Cloudflare Queue.',
    parameters: {
      type: 'object',
      properties: {
        queueId: {
          type: 'string',
          description: 'Queue id.',
        },
        body: {
          description: 'Message payload.',
        },
      },
      required: ['queueId', 'body'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        queued: {
          type: 'boolean',
          description: 'Always true once the API accepted the message.',
        },
      },
      required: ['queued'],
      description: 'Confirmation that the message was queued.',
    },
  },
}

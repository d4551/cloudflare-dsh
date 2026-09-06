import { describe, expect, it } from 'vitest'
import * as dataTools from '../src/tools/data.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The model-facing contract for every data tool.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation — so
 * they are pinned explicitly here rather than left to drift. These are written
 * out in full on purpose: changing one has to be a deliberate edit that shows
 * up in review, which a re-recordable snapshot would not guarantee.
 */
const CONTRACT: Record<string, { description: string; parameters: unknown; output: unknown }> = {
  cloudflare_d1_list: {
    description:
      'List the D1 databases in the Cloudflare account, one page at a time. Returns the total and whether this page is the last.',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number, from 1; the first page when omitted.',
        },
        perPage: {
          type: 'integer',
          description: 'Databases per page (default 50).',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        databases: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Database records as the API returns them.',
        },
        page: {
          type: 'integer',
          description: 'The page this is.',
        },
        perPage: {
          type: 'integer',
          description: 'Items requested per page.',
        },
        total: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Items the API says exist in all; null when it did not say.',
        },
        complete: {
          type: 'boolean',
          description:
            'Whether this page is the last: certain when the total is known, inferred from a short page otherwise.',
        },
      },
      required: ['databases', 'page', 'perPage', 'total', 'complete'],
      description: 'One page of D1 databases, and where it sits in the whole.',
    },
  },
  cloudflare_d1_query: {
    description:
      'Run SQL against a D1 database. Handles multi-statement SQL. Use params for bound values rather than string interpolation.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: {
          type: 'string',
          description: 'D1 database id.',
        },
        sql: {
          type: 'string',
          description: 'SQL to execute.',
        },
        params: {
          type: 'array',
          description: 'Bound parameters for ? placeholders.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['databaseId', 'sql'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          description: 'Result sets as the API returns them.',
        },
      },
      required: ['results'],
      description: 'Query results.',
    },
  },
  cloudflare_kv_delete: {
    description: 'Delete one key, or several keys, from a Workers KV namespace.',
    parameters: {
      type: 'object',
      properties: {
        namespaceId: {
          type: 'string',
          description: 'KV namespace id.',
        },
        keys: {
          type: 'array',
          description: 'Keys to delete.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['namespaceId', 'keys'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requested: {
          type: 'integer',
          description: 'Keys in the request.',
        },
        deleted: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Keys Cloudflare reports deleted; null when it reported no count.',
        },
        failed: {
          oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          description:
            'Keys Cloudflare reports as not deleted, to be retried; null when the response carried no such list.',
        },
      },
      required: ['requested', 'deleted', 'failed'],
      description: 'What Cloudflare reported about the deletion.',
    },
  },
  cloudflare_kv_get: {
    description: 'Read one key from a Workers KV namespace. Returns the stored value as text.',
    parameters: {
      type: 'object',
      properties: {
        namespaceId: {
          type: 'string',
          description: 'KV namespace id.',
        },
        key: {
          type: 'string',
          description: 'Key to read.',
        },
      },
      required: ['namespaceId', 'key'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        key: {
          type: 'string',
          description: 'The key that was read.',
        },
        value: {
          type: 'string',
          description: 'The stored value, verbatim.',
        },
      },
      required: ['key', 'value'],
      description: 'The key and its stored value.',
    },
  },
  cloudflare_kv_list_keys: {
    description:
      'List keys in a Workers KV namespace. Returns the cursor for the next page and whether the listing is complete.',
    parameters: {
      type: 'object',
      properties: {
        namespaceId: {
          type: 'string',
          description: 'KV namespace id.',
        },
        prefix: {
          type: 'string',
          description: 'Only list keys starting with this prefix.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum keys to return (default 1000).',
        },
        cursor: {
          type: 'string',
          description: 'Cursor returned by a previous page; omit for the first page.',
        },
      },
      required: ['namespaceId'],
    },
    output: {
      type: 'object',
      description: 'Keys and paging state.',
      additionalProperties: false,
      properties: {
        keys: {
          type: 'array',
          description: 'Key entries as the API returns them.',
          items: { type: 'object', additionalProperties: true },
        },
        cursor: {
          type: 'string',
          description: 'Cursor for the next page; empty when complete.',
        },
        complete: {
          type: 'boolean',
          description: 'Whether every key has been returned.',
        },
      },
      required: ['keys', 'cursor', 'complete'],
    },
  },
  cloudflare_kv_namespace_list: {
    description:
      'List the Workers KV namespaces in the Cloudflare account, one page at a time. Returns the total and whether this page is the last.',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number, from 1; the first page when omitted.',
        },
        perPage: {
          type: 'integer',
          description: 'Namespaces per page (default 50).',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        namespaces: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Namespace records as the API returns them.',
        },
        page: {
          type: 'integer',
          description: 'The page this is.',
        },
        perPage: {
          type: 'integer',
          description: 'Items requested per page.',
        },
        total: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Items the API says exist in all; null when it did not say.',
        },
        complete: {
          type: 'boolean',
          description:
            'Whether this page is the last: certain when the total is known, inferred from a short page otherwise.',
        },
      },
      required: ['namespaces', 'page', 'perPage', 'total', 'complete'],
      description: 'One page of KV namespaces, and where it sits in the whole.',
    },
  },
  cloudflare_kv_put: {
    description: 'Write one or more key/value pairs to a Workers KV namespace. Values are stored as text.',
    parameters: {
      type: 'object',
      properties: {
        namespaceId: {
          type: 'string',
          description: 'KV namespace id.',
        },
        entries: {
          type: 'array',
          description: 'Key/value pairs to write.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: {
                type: 'string',
              },
              value: {
                type: 'string',
              },
            },
            required: ['key', 'value'],
          },
        },
      },
      required: ['namespaceId', 'entries'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requested: {
          type: 'integer',
          description: 'Key/value pairs in the request.',
        },
        written: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Pairs Cloudflare reports written; null when it reported no count.',
        },
        failed: {
          oneOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
          description:
            'Keys Cloudflare reports as not written, to be retried; null when the response carried no such list.',
        },
      },
      required: ['requested', 'written', 'failed'],
      description: 'What Cloudflare reported about the write.',
    },
  },
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
        retries: {
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
  cloudflare_r2_bucket_create: {
    description: 'Create an R2 bucket.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Bucket name.',
        },
        locationHint: {
          type: 'string',
          description: 'Preferred region hint, e.g. wnam, enam, weur, eeur, apac.',
        },
      },
      required: ['name'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bucket: {
          description: 'The bucket record as the API returns it.',
        },
      },
      required: ['bucket'],
      description: 'The bucket that was created.',
    },
  },
  cloudflare_r2_bucket_list: {
    description:
      'List the R2 buckets in the Cloudflare account. Returns the cursor for the next page and whether the listing is complete.',
    parameters: {
      type: 'object',
      properties: {
        perPage: {
          type: 'integer',
          description: 'Buckets per page (default 50).',
        },
        cursor: {
          type: 'string',
          description: 'Cursor returned by a previous page; omit for the first page.',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        buckets: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Bucket records as the API returns them.',
        },
        cursor: {
          type: 'string',
          description: 'Cursor for the next page; empty when complete.',
        },
        complete: {
          type: 'boolean',
          description: 'Whether every bucket has been returned.',
        },
      },
      required: ['buckets', 'cursor', 'complete'],
      description: 'One page of R2 buckets and the cursor for the next.',
    },
  },
}

describe('data tool contract', () => {
  const h = makeHarness(dataTools, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect(h.names().toSorted()).toEqual(Object.keys(CONTRACT).toSorted())
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted description', (name) => {
    expect(h.tool(name).description).toBe(CONTRACT[name]!.description)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted parameter schema', (name) => {
    expect(h.tool(name).parameters).toStrictEqual(CONTRACT[name]!.parameters)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted output schema', (name) => {
    expect(h.tool(name).output.schema).toStrictEqual(CONTRACT[name]!.output)
  })
})

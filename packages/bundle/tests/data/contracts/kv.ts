import type { ToolContract } from './shared.ts'

/** The contracted surface of the Workers KV tools. */
export const KV_CONTRACT: Record<string, ToolContract> = {
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
}

import type { ToolContract } from '../../data/contracts/shared.ts'

/** The contracted surface of the Vectorize tools. */
export const VECTORIZE_CONTRACT: Record<string, ToolContract> = {
  cloudflare_vectorize_index_list: {
    description: 'List the Vectorize indexes in the Cloudflare account.',
    parameters: {
      type: 'object',
      properties: {},
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        indexes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Index records as the API returns them.',
        },
      },
      required: ['indexes'],
      description: 'Vector indexes in the account.',
    },
  },
  cloudflare_vectorize_upsert: {
    description:
      'Write vectors to a Vectorize index. upsert replaces a vector that already carries the id; insert leaves it alone and reports the id as a duplicate.',
    parameters: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: 'Index name.',
        },
        vectors: {
          type: 'array',
          description: 'Vectors to write.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
                description: 'Vector identifier.',
              },
              values: {
                type: 'array',
                description: 'The vector itself; its length must match the index dimensions.',
                items: {
                  type: 'number',
                },
              },
              metadata: {
                description: 'Metadata stored beside the vector.',
              },
            },
            required: ['id', 'values'],
          },
        },
        mode: {
          type: 'string',
          description: 'upsert (default) overwrites an existing id; insert refuses it.',
          enum: ['upsert', 'insert'],
        },
        unparsableBehavior: {
          type: 'string',
          description: 'What to do with a vector the API cannot parse: error (default) or discard.',
          enum: ['error', 'discard'],
        },
      },
      required: ['indexName', 'vectors'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        written: {
          type: 'integer',
          description: 'Vectors sent in the request.',
        },
        mutation: {
          description: 'The mutation record as the API returns it; a write is applied asynchronously.',
        },
      },
      required: ['written', 'mutation'],
      description: 'What the write reported.',
    },
  },
  cloudflare_vectorize_delete: {
    description: 'Delete vectors from a Vectorize index by id.',
    parameters: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: 'Index name.',
        },
        ids: {
          type: 'array',
          description: 'Vector identifiers to delete.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['indexName', 'ids'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requested: {
          type: 'integer',
          description: 'Identifiers in the request.',
        },
        mutation: {
          description: 'The mutation record as the API returns it; a deletion is applied asynchronously.',
        },
      },
      required: ['requested', 'mutation'],
      description: 'What the deletion reported.',
    },
  },
  cloudflare_vectorize_get: {
    description: 'Read vectors back from a Vectorize index by id.',
    parameters: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: 'Index name.',
        },
        ids: {
          type: 'array',
          description: 'Vector identifiers to read.',
          items: {
            type: 'string',
          },
        },
      },
      required: ['indexName', 'ids'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vectors: {
          description: 'The vectors as the API returns them; an unknown id is simply absent.',
        },
      },
      required: ['vectors'],
      description: 'The vectors the index holds for those identifiers.',
    },
  },
  cloudflare_vectorize_query: {
    description: 'Query a Vectorize index by vector and return the nearest matches.',
    parameters: {
      type: 'object',
      properties: {
        indexName: {
          type: 'string',
          description: 'Index name.',
        },
        vector: {
          type: 'array',
          description: 'Query vector.',
          items: {
            type: 'number',
          },
        },
        topK: {
          type: 'integer',
          description: 'How many matches to return (default 5).',
        },
        returnValues: {
          type: 'boolean',
          description: 'Include stored vectors in the response.',
        },
        returnMetadata: {
          type: 'string',
          description:
            'How much stored metadata to return: none, only the indexed fields, or all of it. Defaults to all.',
          enum: ['none', 'indexed', 'all'],
        },
      },
      required: ['indexName', 'vector'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        matches: {
          description: 'The query result as the API returns it.',
        },
      },
      required: ['matches'],
      description: 'Nearest matches.',
    },
  },
}

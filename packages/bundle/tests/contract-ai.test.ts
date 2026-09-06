import { describe, expect, it } from 'vitest'
import * as toolsModule from '../src/tools/ai.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The model-facing contract for every tool in this module.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation, so they
 * are pinned explicitly rather than left to drift. Written out in full on
 * purpose: changing one has to be a deliberate edit visible in review.
 */
const CONTRACT: Record<string, { description: string; parameters: unknown; output: unknown }> = {
  cloudflare_ai_model_schema: {
    description:
      'Fetch the JSON schema Cloudflare publishes for one Workers AI model, so cloudflare_ai_run can be called with the right input shape.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model slug.',
        },
      },
      required: ['model'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description: 'Model slug the schema describes.',
        },
        schema: {
          description: 'The JSON schema Cloudflare publishes for the model.',
        },
      },
      required: ['model', 'schema'],
      description: 'The model and its published JSON schema.',
    },
  },
  cloudflare_ai_models_search: {
    description:
      'Search the Workers AI model catalogue by name or task, one page at a time. The catalogue reports no total, so a full page means more may follow.',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Substring to match against model names.',
        },
        task: {
          type: 'string',
          description: 'Task filter, e.g. "Text Generation".',
        },
        page: {
          type: 'integer',
          description: 'Page number, from 1; the first page when omitted.',
        },
        perPage: {
          type: 'integer',
          description: 'Models per page (default 50).',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        models: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Catalogue entries as the API returns them.',
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
      required: ['models', 'page', 'perPage', 'total', 'complete'],
      description: 'One page of model catalogue entries, and where it sits in the whole.',
    },
  },
  cloudflare_ai_run: {
    description:
      'Run a Workers AI model and return its complete response. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape. Streaming belongs to the cloudflare-workers-ai model provider, so an input with stream: true is refused.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model slug, e.g. @cf/meta/llama-3.1-8b-instruct.',
        },
        input: {
          description: 'Model input, matching that model\u2019s schema.',
        },
      },
      required: ['model', 'input'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description: 'Model slug that produced the output.',
        },
        output: {
          description: 'The model output as Workers AI returned it.',
        },
      },
      required: ['model', 'output'],
      description: 'The model that ran and what it returned.',
    },
  },
  cloudflare_aigateway_cost: {
    description:
      'Read AI Gateway billing: the prepaid credit balance, usage history, or the current invoice preview.',
    parameters: {
      type: 'object',
      properties: {
        view: {
          type: 'string',
          description: 'Which billing view to read.',
          enum: ['credit-balance', 'usage-history', 'invoice-preview'],
        },
      },
      required: ['view'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        view: {
          type: 'string',
          enum: ['credit-balance', 'usage-history', 'invoice-preview'],
          description: 'Which billing view was read.',
        },
        billing: {
          description: 'The billing payload as the API returns it.',
        },
      },
      required: ['view', 'billing'],
      description: 'The requested billing view.',
    },
  },
  cloudflare_aigateway_get: {
    description: 'Fetch one AI Gateway\u2019s configuration.',
    parameters: {
      type: 'object',
      properties: {
        gatewayId: {
          type: 'string',
          description: 'Gateway id.',
        },
      },
      required: ['gatewayId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gateway: {
          type: 'object',
          additionalProperties: true,
          description: 'The gateway record as the API returns it.',
        },
      },
      required: ['gateway'],
      description: 'One gateway.',
    },
  },
  cloudflare_aigateway_list: {
    description:
      'List the AI Gateways in the Cloudflare account, one page at a time. The endpoint reports no total, so a full page means more may follow.',
    parameters: {
      type: 'object',
      properties: {
        page: {
          type: 'integer',
          description: 'Page number, from 1; the first page when omitted.',
        },
        perPage: {
          type: 'integer',
          description: 'Gateways per page (default 50).',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        gateways: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Gateway records as the API returns them.',
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
      required: ['gateways', 'page', 'perPage', 'total', 'complete'],
      description: 'One page of gateways, and where it sits in the whole.',
    },
  },
  cloudflare_aigateway_log_body: {
    description: 'Fetch the stored request or response body for one AI Gateway log entry.',
    parameters: {
      type: 'object',
      properties: {
        gatewayId: {
          type: 'string',
          description: 'Gateway id.',
        },
        logId: {
          type: 'string',
          description: 'Log entry id.',
        },
        part: {
          type: 'string',
          description: 'Which body to fetch.',
          enum: ['request', 'response'],
        },
      },
      required: ['gatewayId', 'logId', 'part'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        body: {
          description: 'The request or response body as stored by the gateway.',
        },
      },
      required: ['body'],
      description: 'The stored body.',
    },
  },
  cloudflare_aigateway_logs: {
    description:
      'Query AI Gateway request logs. Filter by metadata to isolate one harness session: requests made through the Cloudflare model provider carry the session id in cf-aig-metadata.',
    parameters: {
      type: 'object',
      properties: {
        gatewayId: {
          type: 'string',
          description: 'Gateway id.',
        },
        page: {
          type: 'integer',
          description: '1-based page number (default 1).',
        },
        perPage: {
          type: 'integer',
          description: 'Log entries per page, 1-50 (default 50).',
        },
        filters: {
          type: 'array',
          description:
            'Filter clauses. Metadata is filtered as two clauses — {"key":"metadata.key","operator":"eq","value":"sessionId"} and {"key":"metadata.value","operator":"eq","value":"<id>"} — because the endpoint exposes key and value as separate fields.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              key: {
                type: 'string',
                enum: [
                  'id',
                  'created_at',
                  'request_type',
                  'success',
                  'cached',
                  'provider',
                  'model',
                  'model_type',
                  'cost',
                  'tokens',
                  'tokens_in',
                  'tokens_out',
                  'duration',
                  'feedback',
                  'event_id',
                  'metadata.key',
                  'metadata.value',
                ],
              },
              operator: {
                type: 'string',
                enum: ['eq', 'neq', 'contains', 'lt', 'gt'],
              },
              value: {
                type: 'string',
              },
            },
            required: ['key', 'operator', 'value'],
          },
        },
      },
      required: ['gatewayId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        logs: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Log entries as the API returns them.',
        },
        page: {
          type: 'integer',
          description: '1-based page number that was read.',
        },
        perPage: {
          type: 'integer',
          description: 'Entries requested per page.',
        },
        complete: {
          type: 'boolean',
          description: 'Whether this page was short, so no page follows.',
        },
      },
      required: ['logs', 'page', 'perPage', 'complete'],
      description: 'Matching log entries and the page they came from.',
    },
  },
  cloudflare_aigateway_routes: {
    description: 'List the dynamic routing rules configured on an AI Gateway.',
    parameters: {
      type: 'object',
      properties: {
        gatewayId: {
          type: 'string',
          description: 'Gateway id.',
        },
      },
      required: ['gatewayId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        routes: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Route records as the API returns them.',
        },
      },
      required: ['routes'],
      description: 'Dynamic routes.',
    },
  },
  cloudflare_aigateway_session_cost: {
    description:
      'Summarise what one harness session cost through AI Gateway, by reading the gateway logs tagged with that session id.',
    parameters: {
      type: 'object',
      properties: {
        gatewayId: {
          type: 'string',
          description: 'Gateway id.',
        },
        sessionId: {
          type: 'string',
          description: 'Harness session id.',
        },
        perPage: {
          type: 'integer',
          description: 'Log entries per page while scanning, 1-50 (default 50).',
        },
      },
      required: ['gatewayId', 'sessionId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        requests: {
          type: 'integer',
          description: 'Log entries that carried the session id.',
        },
        cost: {
          type: 'number',
          description: 'Sum of the cost field over those entries.',
        },
        tokensIn: {
          type: 'number',
          description: 'Sum of tokens_in over those entries.',
        },
        tokensOut: {
          type: 'number',
          description: 'Sum of tokens_out over those entries.',
        },
        cached: {
          type: 'integer',
          description: 'Entries the gateway served from cache.',
        },
        scanned: {
          type: 'integer',
          description: 'Log entries read across every page, matched or not.',
        },
        pages: {
          type: 'integer',
          description: 'Pages read.',
        },
        truncated: {
          type: 'boolean',
          description: 'Whether the page ceiling stopped the scan before the last page.',
        },
      },
      required: ['requests', 'cost', 'tokensIn', 'tokensOut', 'cached', 'scanned', 'pages', 'truncated'],
      description:
        'Request count, total cost, tokens, and cache hits for the session, plus how far the scan reached.',
    },
  },
  cloudflare_aisearch_chat: {
    description: 'Ask an AI Search instance a question and get an answer grounded in its indexed content.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
        query: {
          type: 'string',
          description: 'Question to answer.',
        },
        model: {
          type: 'string',
          description: 'Override the generating model.',
        },
      },
      required: ['instanceId', 'query'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: {
          description: 'The answer payload as the API returns it.',
        },
      },
      required: ['answer'],
      description: 'The grounded answer.',
    },
  },
  cloudflare_aisearch_search: {
    description:
      'Search an AI Search instance (formerly AutoRAG) and return the matching chunks, without generating an answer.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
        query: {
          type: 'string',
          description: 'Search query.',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum chunks to return (default 10).',
        },
      },
      required: ['instanceId', 'query'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          description: 'Search results as the API returns them.',
        },
      },
      required: ['results'],
      description: 'Matching chunks.',
    },
  },
  cloudflare_aisearch_sync: {
    description: 'Trigger an indexing job for an AI Search instance so new source content is picked up.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
      },
      required: ['instanceId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        job: {
          description: 'The job record as the API returns it.',
        },
      },
      required: ['job'],
      description: 'The sync job that was started.',
    },
  },
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

describe('ai tool contract', () => {
  const h = makeHarness(toolsModule, async () => envelope(null))

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

import type { ToolContract } from '../../data/contracts/shared.ts'

/** The contracted surface of the AI Gateway administration tools. */
export const GATEWAY_CONTRACT: Record<string, ToolContract> = {
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
    description: 'Fetch one AI Gateway’s configuration.',
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
          description: 'Page number, from 1; the first page when omitted.',
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
          description: 'Log entry records as the API returns them.',
        },
        page: {
          type: 'integer',
          description: 'The page this is.',
        },
        perPage: {
          type: 'integer',
          description: 'Items requested per page.',
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
}

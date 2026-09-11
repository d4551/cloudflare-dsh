import type { ToolContract } from './shared.ts'

/** The contracted surface of the D1 tools. */
export const D1_CONTRACT: Record<string, ToolContract> = {
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
}

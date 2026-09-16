import { pagedOutput, type ToolContract } from './shared.ts'

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
    output: pagedOutput('databases', 'Database records', 'D1 databases'),
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

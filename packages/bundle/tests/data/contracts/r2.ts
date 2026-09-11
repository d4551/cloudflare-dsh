import type { ToolContract } from './shared.ts'

/** The contracted surface of the R2 tools. */
export const R2_CONTRACT: Record<string, ToolContract> = {
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

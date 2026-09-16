import type { JsonValue } from '@d4551/dsh-cloudflare-core/types'

/**
 * The shapes every family's pinned contracts share.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation — so
 * they are written out in full on purpose: changing one has to be a deliberate
 * edit that shows up in review, which a re-recordable snapshot would not
 * guarantee.
 */
export interface ToolContract {
  readonly description: string
  readonly parameters: JsonValue
  readonly output: JsonValue
}

/**
 * The output envelope of a page-numbered listing.
 *
 * Cloudflare answers one of these with the records, the page, the page size,
 * the total it may or may not report, and whether this page is the last —
 * `_shared/paging.ts` in the source builds exactly that. Listing tools across
 * two families return it, so it is written once here, independently of the
 * source module, and each family names its own records; a change to the
 * source's envelope still fails every one of those tools.
 */
export function pagedOutput(recordsField: string, records: string, family: string): JsonValue {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      [recordsField]: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: `${records} as the API returns them.`,
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
    required: [recordsField, 'page', 'perPage', 'total', 'complete'],
    description: `One page of ${family}, and where it sits in the whole.`,
  }
}

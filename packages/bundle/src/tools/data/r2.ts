/**
 * R2 tools: bucket listing and creation.
 *
 * Registration only. Every path and body decision lives in
 * `../../specs/data.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { r2BucketCreateSpec, r2BucketListSpec } from '../../specs/data.ts'
import { cursorNote, cursorOutcome, cursorOutcomeProperties } from '../_shared/paging.ts'
import { type JsonValue } from '../_shared/json.ts'
import { apiRecords, listing, text } from '../_shared/render.ts'
import type { DataToolsConfig } from './config.ts'

/** Register the R2 tools on the harness tool registry. */
export function registerR2(ctx: Context, cf: CloudflareService, config: DataToolsConfig): void {
  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_list',
      description:
        'List the R2 buckets in the Cloudflare account. Returns the cursor for the next page and whether the listing is complete.',
      parameters: {
        perPage: { type: 'integer', description: `Buckets per page (default ${config.pageSize}).` },
        cursor: {
          type: 'string',
          description: 'Cursor returned by a previous page; omit for the first page.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of R2 buckets and the cursor for the next.',
          properties: {
            buckets: apiRecords('Bucket'),
            ...cursorOutcomeProperties('bucket'),
          },
        },
        render: (_args, value) => listing(value.buckets.length, 'bucket', value, cursorNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const envelope = await cf.accountRequestEnvelope<{ buckets?: Record<string, JsonValue>[] }>({
          ...r2BucketListSpec(args.perPage ?? config.pageSize, args.cursor),
          signal: exec.signal,
        })
        return { buckets: envelope.result.buckets ?? [], ...cursorOutcome(envelope.result_info) }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_r2_bucket_create',
      description: 'Create an R2 bucket.',
      parameters: {
        name: { type: 'string', required: true, description: 'Bucket name.' },
        locationHint: {
          type: 'string',
          description: 'Preferred region hint, e.g. wnam, enam, weur, eeur, apac.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The bucket that was created.',
          properties: {
            bucket: { type: 'json', required: true, description: 'The bucket record as the API returns it.' },
          },
        },
        render: (args) => text(`Created R2 bucket ${args.name}.`),
      },
      async execute(args, exec) {
        const bucket = await cf.accountRequest<JsonValue>({
          ...r2BucketCreateSpec(args.name, args.locationHint),
          signal: exec.signal,
        })
        return { bucket }
      },
    }),
  )
}

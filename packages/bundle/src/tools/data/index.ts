/**
 * `cloudflare-dsh/tools/data` — data-plane tools: Workers KV, D1, Queues, and
 * R2 bucket management.
 *
 * Composition only: each product family is registered by its own module, and
 * the paths, queries and bodies they send live in `../../specs/data.ts` as
 * pure functions. The KV bulk-shape error this package publishes to its tests
 * is re-exported here by name.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { DataToolsConfig } from './config.ts'
import { registerD1 } from './d1.ts'
import { registerKv } from './kv.ts'
import { registerQueues } from './queue.ts'
import { registerR2 } from './r2.ts'
import { seam } from '../../seam.ts'

export { KvBulkResultShapeError } from './kv.ts'
export { Config, type DataToolsConfig } from './config.ts'

export const name = 'cloudflare-tools-data'
export const inject = ['tools', 'cloudflare']

export function apply(ctx: Context, config: DataToolsConfig): void {
  const cf = seam(ctx)
  registerKv(ctx, cf, config)
  registerD1(ctx, cf, config)
  registerQueues(ctx, cf, config)
  registerR2(ctx, cf, config)
}

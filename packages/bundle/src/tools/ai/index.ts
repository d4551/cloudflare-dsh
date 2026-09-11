/**
 * `cloudflare-dsh/tools/ai` — Workers AI, AI Gateway and AI Search tools.
 *
 * Composition only: each tool family is registered by its own module, and the
 * paths, queries and bodies they send live in `../../specs/ai.ts` as pure
 * functions. The session-log arithmetic this package publishes to its tests
 * and the client contract is re-exported here by name.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerAiSearch } from './aisearch.ts'
import { Config, type AiToolsConfig } from './config.ts'
import { registerGateway } from './gateway.ts'
import { registerSessionCost } from './sessionCost.ts'
import { registerVectorize } from './vectorize.ts'
import { registerWorkersAi } from './run.ts'
import { seam } from '../../seam.ts'

export { AiRunStreamError } from './stream.ts'
export { GatewayLogShapeError, sessionOf, summariseSessionLogs } from './session.ts'
export { Config, type AiToolsConfig } from './config.ts'

export const name = 'cloudflare-tools-ai'
export const inject = ['tools', 'cloudflare']

export function apply(ctx: Context, config: AiToolsConfig): void {
  const cf = seam(ctx)
  registerWorkersAi(ctx, cf, config)
  registerGateway(ctx, cf, config)
  registerAiSearch(ctx, cf, config)
  registerVectorize(ctx, cf, config)
  registerSessionCost(ctx, cf)
}

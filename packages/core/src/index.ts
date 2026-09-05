/**
 * `@d4551/dsh-cloudflare-core` — the Cloudflare capability seam.
 *
 * Registers `ctx.cloudflare` for other plugins to consume via
 * `inject: ['cloudflare']`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { type CloudflareConfig, CloudflareConfig as ConfigSchema } from './config.ts'
import type { CredentialResolver } from './credentials.ts'
import { CloudflareService } from './service.ts'

export * from './client.ts'
export * from './config.ts'
export * from './credentials.ts'
export * from './errors.ts'
export * from './paginate.ts'
export * from './request.ts'
export * from './retry.ts'
export * from './scope.ts'
export * from './service.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    cloudflare: CloudflareService
  }
}

/** Plugin name, as it appears in `cordis.yml` diagnostics. */
export const name = 'cloudflare'

/** Services this plugin requires before it can activate. */
export const inject = ['credentials'] as const

/** Configuration schema. Cordis validates against this before `apply` runs. */
export const Config = ConfigSchema

/** The context shape this plugin needs from the harness. */
interface HarnessContext extends Context {
  credentials: CredentialResolver
}

/**
 * Register the Cloudflare service.
 *
 * Constructing a Cordis `Service` registers it on the context and binds it to
 * the current fiber, so it is unregistered automatically when the plugin
 * unloads. No explicit effect or disposer is needed — adding one would only
 * duplicate a lifetime the framework already owns.
 *
 * The instance is returned for the benefit of direct callers and tests; Cordis
 * itself ignores the return value.
 */
export function apply(ctx: Context, config: CloudflareConfig): CloudflareService {
  const harness = ctx as HarnessContext
  return new CloudflareService(ctx, config, { credentials: harness.credentials })
}

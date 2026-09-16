/**
 * `@d4551/dsh-cloudflare-core` — the Cloudflare capability seam.
 *
 * This module is the Cordis plugin entry: it registers `ctx.cloudflare` for
 * other plugins to consume via `inject: ['cloudflare']`. Alongside the entry
 * declarations it re-exports, by name, the seam surface a consumer of the
 * service needs — the client, its config schema and the service itself — so a
 * consumer can import the seam without reaching into module internals. The
 * remaining modules publish as their own subpaths (`./errors`, `./paginate`,
 * `./request`, `./types`), so every import names the module that defines what
 * it imports and no `export *` layer sits anywhere.
 */
import type { Context } from '@deepseek-ai/cordis'
import { type CloudflareConfig, CloudflareConfig as ConfigSchema } from './config.ts'
import type { CredentialResolver } from './credentials.ts'
import { CloudflareService } from './service.ts'

export {
  TRANSPORT_FAILURE_STATUS,
  CloudflareClient,
  readEnvelope,
  realSleep,
  statusOfError,
  type BinaryBody,
  type CloudflareClientOptions,
  type EnvelopeRead,
  type FetchLike,
} from './client.ts'
export { CloudflareConfig } from './config.ts'
export {
  CloudflareAmbiguousAccountError,
  CloudflareNoAccountError,
  CloudflareService,
  type CloudflareAccount,
  type CloudflareServiceDeps,
} from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    cloudflare: CloudflareService
  }
}

/** Plugin name, as it appears in `cordis.yml` diagnostics. */
export const name = 'cloudflare'

/** Services this plugin requires before it can activate. */
export const inject = ['credentials']

/** Configuration schema. Cordis validates against this before `apply` runs. */
export const Config = ConfigSchema

/**
 * The context shape this plugin needs from the harness.
 *
 * `inject: ['credentials']` is what makes the resolver present, and Cordis
 * expresses that at runtime rather than in the type of `Context`. Spelling the
 * requirement in the parameter type is what removes the cast that used to stand
 * here: a caller that hands over a context without the resolver is refused by
 * the compiler, which is the same statement `inject` makes at runtime.
 */
export type HarnessContext = Context & { readonly credentials: CredentialResolver }

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
export function apply(ctx: HarnessContext, config: CloudflareConfig): CloudflareService {
  return new CloudflareService(ctx, config, {
    credentials: ctx.credentials,
    // The platform function itself, bound as the transport: no lambda sits
    // between the seam and the global, and every test substitutes its own.
    fetch,
  })
}

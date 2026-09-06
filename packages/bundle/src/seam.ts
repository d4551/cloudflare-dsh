/**
 * Reaching the Cloudflare capability seam from a context.
 *
 * Five modules declared the same three-line interface and performed the same
 * cast to get at `ctx.cloudflare` — the four tool groups and the model
 * provider. The seam is one thing, so it is described in one place.
 *
 * The cast is unavoidable and deliberate: `inject: ['cloudflare']` is what
 * makes the service present, and Cordis expresses that at runtime rather than
 * in the type of `Context`. Confining it here means there is one place to look
 * when that changes.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'

/** A context on which the Cloudflare seam has been provided. */
interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** The Cloudflare seam a plugin declaring `inject: ['cloudflare']` is given. */
export function seam(ctx: Context): CloudflareService {
  return (ctx as CloudflareContext).cloudflare
}

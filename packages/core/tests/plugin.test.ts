import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../src/client.ts'
import * as plugin from '../src/index.ts'
import { CloudflareService } from '../src/service.ts'

/** A context with a credentials service, as the harness would supply. */
function harnessContext(resolve: (ref: string) => string | undefined = () => 'tok') {
  const ctx = new Context()
  ctx.provide('credentials', { resolve })
  return ctx
}

describe('plugin shape', () => {
  it('exports a name, so cordis diagnostics can identify it', () => {
    expect(plugin.name).toBe('cloudflare')
  })

  it('declares the credentials service as a dependency', () => {
    expect(plugin.inject).toEqual(['credentials'])
  })

  it('exports a Standard Schema Config, as cordis requires', () => {
    expect('~standard' in plugin.Config).toBe(true)
  })

  it('exports apply as a function taking a context and config', () => {
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.apply.length).toBe(2)
  })

  it('returns the constructed service to direct callers', () => {
    const ctx = harnessContext()
    expect(plugin.apply(ctx, plugin.Config({}))).toBeInstanceOf(CloudflareService)
  })
})

describe('plugin lifecycle', () => {
  it('provides ctx.cloudflare once loaded', async () => {
    const ctx = harnessContext()
    await ctx.plugin(plugin, {})
    expect(ctx.cloudflare).toBeInstanceOf(CloudflareService)
  })

  it('passes validated config through to the service', async () => {
    const ctx = harnessContext()
    await ctx.plugin(plugin, { accountId: 'a42', maxRetries: 5 })
    expect(ctx.cloudflare.config.accountId).toBe('a42')
    expect(ctx.cloudflare.config.maxRetries).toBe(5)
  })

  it('applies schema defaults for fields the patch omits', async () => {
    const ctx = harnessContext()
    await ctx.plugin(plugin, {})
    expect(ctx.cloudflare.config.apiTokenRef).toBe('CLOUDFLARE_API_TOKEN')
  })

  it('wires the configured credential reference into the client', async () => {
    const ctx = harnessContext()
    await ctx.plugin(plugin, { apiTokenRef: 'CF_ALT_TOKEN' })
    expect(ctx.cloudflare.client.apiTokenRef).toBe('CF_ALT_TOKEN')
  })

  // The harness convention: every registry contribution is an effect, so
  // disposing the fiber must leave no trace behind. This is the HMR guarantee.
  it('removes ctx.cloudflare when the fiber is disposed', async () => {
    const ctx = harnessContext()
    const fiber = await ctx.plugin(plugin, {})
    expect(ctx.cloudflare).toBeInstanceOf(CloudflareService)
    await fiber.dispose()
    expect(ctx.cloudflare).toBeUndefined()
  })

  it('can be reloaded after disposal, as hot-reload requires', async () => {
    const ctx = harnessContext()
    const first = await ctx.plugin(plugin, { accountId: 'first' })
    await first.dispose()
    await ctx.plugin(plugin, { accountId: 'second' })
    expect(ctx.cloudflare.config.accountId).toBe('second')
  })

  // Proves the harness's credentials service is what actually authenticates
  // requests, not some other resolver the plugin might have reached for.
  it('authenticates requests with the harness credentials service', async () => {
    const globalFetch = vi.fn<FetchLike>(
      async (_request: Request) =>
        new Response(JSON.stringify({ success: true, errors: [], messages: [], result: { ok: 1 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', globalFetch)
    try {
      const ctx = harnessContext((ref) => (ref === 'CF_WIRED' ? 'wired-token' : undefined))
      await ctx.plugin(plugin, { apiTokenRef: 'CF_WIRED', accountId: 'a1' })
      await ctx.cloudflare.accountRequest({ method: 'GET', path: '/x' })
      expect(globalFetch.mock.calls[0]?.[0].headers.get('authorization')).toBe('Bearer wired-token')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not activate before its credentials dependency exists', async () => {
    const ctx = new Context()
    await ctx.plugin(plugin, {})
    expect(ctx.cloudflare).toBeUndefined()
  })
})

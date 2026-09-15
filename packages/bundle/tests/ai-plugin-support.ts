/**
 * Shared fixtures for the cloudflare-llm plugin suites.
 *
 * One source for the envelope response and the wired context, so the plugin
 * suites exercise the same construction a host performs.
 */
import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { expect } from 'vitest'
import type { CloudflareAiProvider } from '../src/ai/provider.ts'
import * as aiPlugin from '../src/ai/index.ts'

/** One registration the capturing runtime recorded. */
export interface CapturedRegistration {
  readonly providers: string[]
  readonly provider: CloudflareAiProvider
}

/** A Cloudflare envelope response carrying one result. */
export function envelope<T>(result: T): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Wire a context with the cloudflare seam and a capturing llm runtime, then
 * apply the plugin exactly as a host would.
 */
export function harness(
  config: Partial<aiPlugin.AiConfig> = {},
  fetchImpl: (r: Request) => Promise<Response> = async () => envelope(null),
  cloudflare: Partial<Parameters<typeof CloudflareConfig>[0]> = {},
): { ctx: Context; requests: Request[]; registered: CapturedRegistration[] } {
  const requests: Request[] = []
  const registered: CapturedRegistration[] = []
  const ctx = new Context()
  const credentials = { resolve: () => 'tok' }
  ctx.provide('credentials', credentials)
  ctx.provide('llm', {
    registerAdapter(providers: string[], provider: CloudflareAiProvider) {
      const registration = { providers, provider }
      registered.push(registration)
      return () => registered.pop()
    },
  })
  const service = new CloudflareService(
    ctx,
    CloudflareConfig({ accountId: 'a1', baseUrl: 'https://api.test/v4', ...cloudflare }),
    {
      credentials,
      fetch: async (request) => {
        requests.push(request)
        return fetchImpl(request)
      },
    },
  )
  expect(service.name).toBe('cloudflare')
  aiPlugin.apply(ctx, aiPlugin.Config(config))
  return { ctx, requests, registered }
}

/**
 * Shared fixtures for the cloudflare-llm plugin suites.
 *
 * One source for the wired context and the stubbed global transport, so the
 * plugin suites exercise the same construction a host performs. The envelope
 * response their API stubs answer with is `envelope` from `harness.ts`, which
 * owns it for every suite in this tree.
 */
import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { FetchLike } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { expect, vi, type Mock } from 'vitest'
import type { CloudflareAiProvider } from '../src/ai/provider.ts'
import * as aiPlugin from '../src/ai/index.ts'
import { envelope } from './harness.ts'

/** One registration the capturing runtime recorded. */
export interface CapturedRegistration {
  readonly providers: string[]
  readonly provider: CloudflareAiProvider
}

/** An installed global transport, with every request it received. */
export interface TransportStub {
  /** Every request the stub received, in order. */
  readonly requests: Request[]
  /** The stub itself, for the call-count assertions its suites make. */
  readonly mock: Mock<FetchLike>
}

/** The credential source the fixtures wire into the seam. */
export interface FixtureCredentials {
  resolve(reference: string): string
}

/**
 * Install the global transport the provider captures when it is constructed.
 *
 * The provider reads `fetch` as it is built, so this has to run before the
 * plugin is applied; the requests are recorded, so a suite can assert both the
 * calls that were made and the calls that were not.
 */
export function stubTransport(respond: (request: Request) => Promise<Response>): TransportStub {
  const requests: Request[] = []
  const mock = vi.fn<FetchLike>(async (request: Request) => {
    requests.push(request)
    return respond(request)
  })
  vi.stubGlobal('fetch', mock)
  return { requests, mock }
}

/**
 * Wire a context with the cloudflare seam and a capturing llm runtime, then
 * apply the plugin exactly as a host would.
 *
 * `credentials` is overridable so a suite can count how often a token is
 * resolved rather than only observing the token that came back.
 */
export function harness(
  config: Partial<aiPlugin.AiConfig> = {},
  fetchImpl: (r: Request) => Promise<Response> = async () => envelope(null),
  cloudflare: Partial<Parameters<typeof CloudflareConfig>[0]> = {},
  credentials: FixtureCredentials = { resolve: () => 'tok' },
): { ctx: Context; requests: Request[]; registered: CapturedRegistration[] } {
  const requests: Request[] = []
  const registered: CapturedRegistration[] = []
  const ctx = new Context()
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

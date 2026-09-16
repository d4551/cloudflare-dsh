import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { FetchLike as MockFetch } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudflareAiProvider } from '../src/ai/provider.ts'
import { envelope, harness } from './ai-plugin-support.ts'
import * as aiPlugin from '../src/ai/index.ts'

/**
 * Consume a stream to its end and report how many chunks it yielded, for the
 * tests that observe the request rather than the chunks. The chunk types are
 * collected along the way, so the count is the length of what was seen.
 */
async function drain(iterable: AsyncIterable<StreamChunk>): Promise<number> {
  const types: StreamChunk['type'][] = []
  for await (const { type } of iterable) types.push(type)
  return types.length
}

describe('endpoint resolution', () => {
  // The stubbed transport is unconditionally unstubbed after each test, so a
  // failure mid-test cannot leak a stub into the next one.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A minimal completion with content: a finish alone is EMPTY_RESPONSE.
  const stop = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`

  /** Drive one stream so the provider resolves an endpoint and issues a call. */
  async function stream(
    config: Partial<aiPlugin.AiConfig>,
    provider: string,
    apiResponses: (r: Request) => Promise<Response>,
  ): Promise<{ outbound: Request[]; chunks: number }> {
    const outbound: Request[] = []
    const globalFetch = vi.fn<MockFetch>(async (request: Request) => {
      outbound.push(request)
      return new Response(stop, { status: 200 })
    })
    vi.stubGlobal('fetch', globalFetch)
    const { registered } = harness(config, apiResponses)
    const types: StreamChunk['type'][] = []
    for await (const { type } of registered[0]!.provider.stream({
      provider,
      model: '@cf/m',
      messages: [],
    })) {
      types.push(type)
    }
    return { outbound, chunks: types.length }
  }

  it('routes workers-ai to the account-scoped OpenAI-compatible path', async () => {
    const { outbound } = await stream({}, 'cloudflare-workers-ai', async () => envelope(null))
    expect(outbound[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/v1/chat/completions')
  })

  it('honours a configured workers-ai path', async () => {
    const { outbound } = await stream(
      { workersAiPath: '/ai/v1/responses' },
      'cloudflare-workers-ai',
      async () => envelope(null),
    )
    expect(outbound[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/v1/responses')
  })

  // The gateway base URL is read from the API, so the provider always talks
  // to the endpoint Cloudflare currently advertises.
  it('resolves the gateway base url from the API', async () => {
    const { outbound } = await stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () =>
      envelope({ url: 'https://gateway.example/v1/acct/gw1/workers-ai' }),
    )
    expect(outbound[0]!.url).toBe('https://gateway.example/v1/acct/gw1/workers-ai/chat/completions')
  })

  // One configuration has one gateway URL: a lookup per plugin instance, not
  // a REST round trip per model call.
  it('reads the gateway url once per plugin instance', async () => {
    const apiRequests: Request[] = []
    const globalFetch = vi.fn<MockFetch>(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const { registered } = harness({ gatewayId: 'gw1' }, async (r) => {
      apiRequests.push(r)
      return envelope({ url: 'https://gateway.example/base' })
    })
    const call = () =>
      drain(
        registered[0]!.provider.stream({ provider: 'cloudflare-ai-gateway', model: '@cf/m', messages: [] }),
      )
    const first = await call()
    const second = await call()
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(apiRequests.filter((r) => r.url.includes('/url/'))).toHaveLength(1)
    expect(globalFetch).toHaveBeenCalledTimes(2)
  })

  it('resolves the token afresh for every call even though the url is remembered', async () => {
    let resolutions = 0
    const credentials = {
      resolve: () => {
        resolutions += 1
        return 'tok'
      },
    }
    const ctx = new Context()
    ctx.provide('credentials', credentials)
    const registered: CloudflareAiProvider[] = []
    ctx.provide('llm', {
      registerAdapter(_providers: string[], provider: CloudflareAiProvider) {
        registered.push(provider)
        return () => registered.pop()
      },
    })
    const service = new CloudflareService(
      ctx,
      CloudflareConfig({ accountId: 'a1', baseUrl: 'https://api.test/v4' }),
      { credentials, fetch: async () => envelope(null) },
    )
    expect(service.name).toBe('cloudflare')
    aiPlugin.apply(ctx, aiPlugin.Config({}))
    const globalFetch = vi.fn<MockFetch>(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const call = () =>
      drain(registered[0]!.stream({ provider: 'cloudflare-workers-ai', model: '@cf/m', messages: [] }))
    const first = await call()
    const second = await call()
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(resolutions).toBe(2)
  })

  it('honours a configured completions path', async () => {
    const { outbound } = await stream(
      { gatewayId: 'gw1', chatCompletionsPath: '/v1/chat/completions' },
      'cloudflare-ai-gateway',
      async () => envelope({ url: 'https://gateway.example/base' }),
    )
    expect(outbound[0]!.url).toBe('https://gateway.example/base/v1/chat/completions')
  })

  // Proves the plugin's gateway settings actually reach the provider's
  // headers, rather than the provider being constructed with defaults.
  it('applies configured gateway header options to outbound requests', async () => {
    const { outbound } = await stream(
      {
        cacheTtlSeconds: 120,
        skipCache: true,
        collectLog: false,
        tags: { env: 'ci' },
      },
      'cloudflare-workers-ai',
      async () => envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-cache-ttl')).toBe('120')
    expect(outbound[0]!.headers.get('cf-aig-skip-cache')).toBe('true')
    expect(outbound[0]!.headers.get('cf-aig-collect-log')).toBe('false')
    expect(outbound[0]!.headers.get('cf-aig-metadata')).toBe('{"env":"ci"}')
  })

  it('routes to the configured gateway, which Workers AI models require', async () => {
    const { outbound } = await stream({ gatewayId: 'gw-7' }, 'cloudflare-workers-ai', async () =>
      envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-gateway-id')).toBe('gw-7')
  })

  it('applies a configured per-token cost override in the documented shape', async () => {
    const { outbound } = await stream(
      { customCostPerTokenIn: 0.001, customCostPerTokenOut: 0.002 },
      'cloudflare-workers-ai',
      async () => envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBe(
      '{"per_token_in":0.001,"per_token_out":0.002}',
    )
  })

  it('applies a cost override configured on the input side alone', async () => {
    // Each side is a reason to send the header on its own; a mutation testing
    // survivor showed only the output side was ever asserted.
    const { outbound } = await stream({ customCostPerTokenIn: 0.001 }, 'cloudflare-workers-ai', async () =>
      envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBe('{"per_token_in":0.001,"per_token_out":0}')
  })

  it('applies a cost override configured on the output side alone', async () => {
    const { outbound } = await stream({ customCostPerTokenOut: 0.002 }, 'cloudflare-workers-ai', async () =>
      envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBe('{"per_token_in":0,"per_token_out":0.002}')
  })

  it('sends no cost override when none is configured, rather than declaring everything free', async () => {
    const { outbound } = await stream({}, 'cloudflare-workers-ai', async () => envelope(null))
    expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBeNull()
  })

  it('applies a configured gateway-side request timeout', async () => {
    const { outbound } = await stream({ gatewayRequestTimeoutMs: 9000 }, 'cloudflare-workers-ai', async () =>
      envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-request-timeout')).toBe('9000')
  })

  it('applies the configured stream idle timeout', async () => {
    const { registered } = harness({ streamIdleTimeoutMs: 25 })
    const never = new ReadableStream<Uint8Array>({ start: () => undefined })
    const globalFetch = vi.fn<MockFetch>(async () => new Response(never, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const run = async (): Promise<number> => {
      const types: StreamChunk['type'][] = []
      for await (const { type } of registered[0]!.provider.stream({
        provider: 'cloudflare-workers-ai',
        model: '@cf/m',
        messages: [],
      })) {
        types.push(type)
      }
      return types.length
    }
    await expect(run()).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('fails loud when the gateway route has no gateway configured', async () => {
    await expect(stream({}, 'cloudflare-ai-gateway', async () => envelope(null))).rejects.toThrow(
      /needs a gatewayId/,
    )
  })

  it('names the missing-gateway error so it is identifiable in a session log', async () => {
    await expect(stream({}, 'cloudflare-ai-gateway', async () => envelope(null))).rejects.toMatchObject({
      name: 'MissingGatewayError',
    })
  })

  it('fails loud when the API returns no gateway url', async () => {
    await expect(
      stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () => envelope(null)),
    ).rejects.toThrow(aiPlugin.MissingGatewayError)
  })

  it('fails loud when the API returns an empty gateway url', async () => {
    await expect(
      stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () => envelope({ url: '' })),
    ).rejects.toThrow(aiPlugin.MissingGatewayError)
  })

  it('asks the API for the configured gateway provider', async () => {
    const apiRequests: Request[] = []
    const globalFetch = vi.fn<MockFetch>(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    const { registered } = harness({ gatewayId: 'gw1', gatewayProvider: 'openai' }, async (r) => {
      apiRequests.push(r)
      return envelope({ url: 'https://gateway.example/base' })
    })
    const chunks = await drain(
      registered[0]!.provider.stream({
        provider: 'cloudflare-ai-gateway',
        model: '@cf/m',
        messages: [],
      }),
    )
    expect(chunks).toBeGreaterThan(0)
    expect(apiRequests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai-gateway/gateways/gw1/url/openai')
  })
})

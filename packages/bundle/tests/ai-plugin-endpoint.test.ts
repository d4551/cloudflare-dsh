/**
 * Where the plugin sends a model call, and what it stamps on the request while
 * doing it.
 *
 * The provider's own behaviour with a resolved endpoint is held by
 * `ai-provider-stream.test.ts`; this suite drives the plugin end to end, so the
 * endpoint comes from the configuration and the account the way a host's would.
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TIMEOUT_CODE } from '../src/ai/errors.ts'
import * as aiPlugin from '../src/ai/index.ts'
import { MODEL, TEXT_TURN } from './ai-provider-support.ts'
import { harness, stubTransport } from './ai-plugin-support.ts'
import { envelope } from './harness.ts'

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

/** The options one fixture call is made with. */
function callOptions(provider: string): GenerateOptions {
  return { provider, model: MODEL, messages: [] }
}

describe('endpoint resolution', () => {
  // The stubbed transport is unconditionally unstubbed after each test, so a
  // failure mid-test cannot leak a stub into the next one.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Drive one stream so the provider resolves an endpoint and issues a call. */
  async function stream(
    config: Partial<aiPlugin.AiConfig>,
    provider: string,
    apiResponses: (r: Request) => Promise<Response>,
  ): Promise<{ outbound: Request[]; chunks: number }> {
    // A minimal turn with content: a finish alone is an empty response.
    const transport = stubTransport(async () => new Response(TEXT_TURN, { status: 200 }))
    const { registered } = harness(config, apiResponses)
    const chunks = await drain(registered[0]!.provider.stream(callOptions(provider)))
    return { outbound: transport.requests, chunks }
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
    const transport = stubTransport(async () => new Response(TEXT_TURN, { status: 200 }))
    const { registered } = harness({ gatewayId: 'gw1' }, async (r) => {
      apiRequests.push(r)
      return envelope({ url: 'https://gateway.example/base' })
    })
    const call = () => drain(registered[0]!.provider.stream(callOptions('cloudflare-ai-gateway')))
    const first = await call()
    const second = await call()
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(apiRequests.filter((r) => r.url.includes('/url/'))).toHaveLength(1)
    expect(transport.mock).toHaveBeenCalledTimes(2)
  })

  it('resolves the token afresh for every call even though the url is remembered', async () => {
    let resolutions = 0
    const credentials = {
      resolve: () => {
        resolutions += 1
        return 'tok'
      },
    }
    // Stubbed before the plugin applies: the provider captures the global
    // transport when it is constructed, so a stub registered afterwards would
    // never be seen by the calls under test.
    stubTransport(async () => new Response(TEXT_TURN, { status: 200 }))
    const { registered } = harness({}, async () => envelope(null), {}, credentials)
    const call = () => drain(registered[0]!.provider.stream(callOptions('cloudflare-workers-ai')))
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
    // Stubbed before the harness applies the plugin: the provider captures the
    // global transport when it is constructed.
    stubTransport(
      async () => new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 }),
    )
    const { registered } = harness({ streamIdleTimeoutMs: 25 })
    const run = drain(registered[0]!.provider.stream(callOptions('cloudflare-workers-ai')))
    await expect(run).rejects.toMatchObject({ code: TIMEOUT_CODE })
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
    stubTransport(async () => new Response(TEXT_TURN, { status: 200 }))
    const { registered } = harness({ gatewayId: 'gw1', gatewayProvider: 'openai' }, async (r) => {
      apiRequests.push(r)
      return envelope({ url: 'https://gateway.example/base' })
    })
    const chunks = await drain(registered[0]!.provider.stream(callOptions('cloudflare-ai-gateway')))
    expect(chunks).toBeGreaterThan(0)
    expect(apiRequests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai-gateway/gateways/gw1/url/openai')
  })
})

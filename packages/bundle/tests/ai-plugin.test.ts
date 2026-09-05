import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareAiAdapter } from '../src/ai/adapter.ts'
import * as aiPlugin from '../src/ai/index.ts'

function envelope<T>(result: T): Response {
  return new Response(JSON.stringify({ success: true, errors: [], messages: [], result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Wire a context with the cloudflare seam and a capturing llm runtime. */
function harness(
  config: Partial<aiPlugin.AiConfig> = {},
  fetchImpl: (r: Request) => Promise<Response> = async () => envelope(null),
) {
  const requests: Request[] = []
  const registered: { providers: string[]; adapter: CloudflareAiAdapter }[] = []
  const ctx = new Context()
  const credentials = { resolve: () => 'tok' }
  ctx.provide('credentials', credentials)
  ctx.provide('llm', {
    registerAdapter(providers: string[], adapter: CloudflareAiAdapter) {
      registered.push({ providers, adapter })
      return () => registered.pop()
    },
  })
  const service = new CloudflareService(
    ctx,
    CloudflareConfig({ accountId: 'a1', baseUrl: 'https://api.test/v4' }),
    {
      credentials,
      fetch: async (request) => {
        requests.push(request)
        return fetchImpl(request)
      },
    },
  )
  expect(service.name).toBe('cloudflare')
  const dispose = aiPlugin.apply(ctx, aiPlugin.Config(config))
  return { ctx, requests, registered, dispose }
}

describe('plugin shape', () => {
  it('declares its name and injections', () => {
    expect(aiPlugin.name).toBe('cloudflare-llm')
    expect(aiPlugin.inject).toEqual(['llm', 'cloudflare'])
  })

  it('exports a Standard Schema Config', () => {
    expect('~standard' in aiPlugin.Config).toBe(true)
  })

  it('defaults to a safe configuration', () => {
    expect(aiPlugin.Config({})).toStrictEqual({
      gatewayId: '',
      gatewayProvider: 'workers-ai',
      chatCompletionsPath: '/chat/completions',
      workersAiPath: '/ai/v1/chat/completions',
      cacheTtlSeconds: 0,
      skipCache: false,
      collectLog: true,
      customCostPerTokenIn: 0,
      customCostPerTokenOut: 0,
      gatewayRequestTimeoutMs: 0,
      tags: {},
      streamIdleTimeoutMs: 300_000,
      models: [],
    })
  })

  it('registers both provider routes on one adapter', () => {
    const { registered } = harness()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.providers).toEqual(['cloudflare-workers-ai', 'cloudflare-ai-gateway'])
    expect(registered[0]!.adapter).toBeInstanceOf(CloudflareAiAdapter)
  })

  it('returns the registration disposer', () => {
    const { dispose, registered } = harness()
    dispose()
    expect(registered).toHaveLength(0)
  })
})

describe('joinUrl', () => {
  it('joins a base and an absolute path', () => {
    expect(aiPlugin.joinUrl('https://x.test', '/chat')).toBe('https://x.test/chat')
  })

  it('does not double the separator', () => {
    expect(aiPlugin.joinUrl('https://x.test/', '/chat')).toBe('https://x.test/chat')
  })

  it('inserts a separator when the path lacks one', () => {
    expect(aiPlugin.joinUrl('https://x.test', 'chat')).toBe('https://x.test/chat')
  })

  it('handles a trailing slash and a relative path together', () => {
    expect(aiPlugin.joinUrl('https://x.test/', 'chat')).toBe('https://x.test/chat')
  })
})

describe('toModelInfo', () => {
  it('maps catalogue entries to advisory model info', () => {
    expect(aiPlugin.toModelInfo('p', [{ name: '@cf/a' }])).toEqual([
      { provider: 'p', id: '@cf/a', name: '@cf/a' },
    ])
  })

  it('carries a description when the catalogue supplies one', () => {
    expect(aiPlugin.toModelInfo('p', [{ name: 'a', description: 'd' }])[0]).toStrictEqual({
      provider: 'p',
      id: 'a',
      name: 'a',
      description: 'd',
    })
  })

  it('omits an absent description rather than emitting undefined', () => {
    expect(aiPlugin.toModelInfo('p', [{ name: 'a' }])[0]).toStrictEqual({
      provider: 'p',
      id: 'a',
      name: 'a',
    })
  })

  it('skips entries with no usable name', () => {
    expect(aiPlugin.toModelInfo('p', [{}, { name: '' }, { name: 'a' }])).toHaveLength(1)
  })

  it('maps an empty catalogue to an empty list', () => {
    expect(aiPlugin.toModelInfo('p', [])).toEqual([])
  })
})

describe('listModels', () => {
  it('queries the catalogue when no models are configured', async () => {
    const { registered, requests } = harness({}, async () => envelope([{ name: '@cf/a' }]))
    await expect(registered[0]!.adapter.listModels('cloudflare-workers-ai')).resolves.toEqual([
      { provider: 'cloudflare-workers-ai', id: '@cf/a', name: '@cf/a' },
    ])
    expect(requests[0]!.url).toContain('/ai/models/search?per_page=100')
  })

  it('uses the configured list without querying the catalogue', async () => {
    const fetchImpl = vi.fn(async () => envelope([]))
    const { registered } = harness({ models: ['@cf/pinned'] }, fetchImpl)
    await expect(registered[0]!.adapter.listModels('cloudflare-workers-ai')).resolves.toEqual([
      {
        provider: 'cloudflare-workers-ai',
        id: '@cf/pinned',
        name: '@cf/pinned',
      },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('endpoint resolution', () => {
  const stop = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`

  /** Drive one stream so the adapter resolves an endpoint and issues a call. */
  async function stream(
    config: Partial<aiPlugin.AiConfig>,
    provider: string,
    apiResponses: (r: Request) => Promise<Response>,
  ) {
    const outbound: Request[] = []
    const globalFetch = vi.fn(async (request: Request) => {
      outbound.push(request)
      return new Response(stop, { status: 200 })
    })
    vi.stubGlobal('fetch', globalFetch)
    try {
      const { registered } = harness(config, apiResponses)
      const chunks = []
      for await (const c of registered[0]!.adapter.stream({
        provider,
        model: '@cf/m',
        messages: [],
      })) {
        chunks.push(c)
      }
      return { outbound, chunks }
    } finally {
      vi.unstubAllGlobals()
    }
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

  // The gateway base URL is read from the API rather than hardcoded, so the
  // adapter always talks to the endpoint Cloudflare currently advertises.
  it('resolves the gateway base url from the API', async () => {
    const { outbound } = await stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () =>
      envelope({ url: 'https://gateway.example/v1/acct/gw1/workers-ai' }),
    )
    expect(outbound[0]!.url).toBe('https://gateway.example/v1/acct/gw1/workers-ai/chat/completions')
  })

  it('honours a configured completions path', async () => {
    const { outbound } = await stream(
      { gatewayId: 'gw1', chatCompletionsPath: '/v1/chat/completions' },
      'cloudflare-ai-gateway',
      async () => envelope({ url: 'https://gateway.example/base' }),
    )
    expect(outbound[0]!.url).toBe('https://gateway.example/base/v1/chat/completions')
  })

  // Proves the plugin's gateway settings actually reach the adapter's headers,
  // rather than the adapter being constructed with defaults.
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

  it('applies a cost override configured on the output side alone', async () => {
    const { outbound } = await stream({ customCostPerTokenOut: 0.002 }, 'cloudflare-workers-ai', async () =>
      envelope(null),
    )
    expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBe('{"per_token_in":0,"per_token_out":0.002}')
  })

  it('sends no cost override when none is configured, rather than declaring everything free', () => {
    return stream({}, 'cloudflare-workers-ai', async () => envelope(null)).then(({ outbound }) => {
      expect(outbound[0]!.headers.get('cf-aig-custom-cost')).toBeNull()
    })
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
    const globalFetch = vi.fn(async () => new Response(never, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const iterate = async () => {
        for await (const _ of registered[0]!.adapter.stream({
          provider: 'cloudflare-workers-ai',
          model: '@cf/m',
          messages: [],
        })) {
          void _
        }
      }
      await expect(iterate()).rejects.toMatchObject({ code: 'TIMEOUT' })
    } finally {
      vi.unstubAllGlobals()
    }
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
      stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () => envelope({})),
    ).rejects.toThrow(aiPlugin.MissingGatewayError)
  })

  it('fails loud when the API returns an empty gateway url', async () => {
    await expect(
      stream({ gatewayId: 'gw1' }, 'cloudflare-ai-gateway', async () => envelope({ url: '' })),
    ).rejects.toThrow(aiPlugin.MissingGatewayError)
  })

  it('asks the API for the configured gateway provider', async () => {
    const apiRequests: Request[] = []
    const globalFetch = vi.fn(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const { registered } = harness({ gatewayId: 'gw1', gatewayProvider: 'openai' }, async (r) => {
        apiRequests.push(r)
        return envelope({ url: 'https://gateway.example/base' })
      })
      for await (const _ of registered[0]!.adapter.stream({
        provider: 'cloudflare-ai-gateway',
        model: '@cf/m',
        messages: [],
      })) {
        void _
      }
    } finally {
      vi.unstubAllGlobals()
    }
    expect(apiRequests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai-gateway/gateways/gw1/url/openai')
  })
})

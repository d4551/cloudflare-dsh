import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareAiAdapter } from '../src/ai/adapter.ts'
import * as aiPlugin from '../src/ai/index.ts'

interface LlmContext extends Context {
  llm: LlmRuntime
}

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
  cloudflare: Partial<Parameters<typeof CloudflareConfig>[0]> = {},
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
})

describe('lifecycle', () => {
  it('registers both routes with the real llm runtime and releases them when the fiber unloads', async () => {
    // Against the real runtime rather than the recording fake: the runtime
    // scopes a registration to the calling plugin's fiber, which is the
    // guarantee that makes unloading the plugin remove its adapter.
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const credentials = { resolve: () => 'tok' }
    ctx.provide('credentials', credentials)
    const service = new CloudflareService(
      ctx,
      CloudflareConfig({ accountId: 'a1', baseUrl: 'https://api.test/v4' }),
      {
        credentials,
        fetch: async () => envelope(null),
      },
    )
    expect(service.name).toBe('cloudflare')
    const providers = () => (ctx as LlmContext).llm.listProviders().map((info) => info.id)

    const fiber = await ctx.plugin(aiPlugin, {})
    expect(providers()).toEqual(expect.arrayContaining(['cloudflare-workers-ai', 'cloudflare-ai-gateway']))
    await fiber.dispose()
    expect(providers()).not.toEqual(expect.arrayContaining(['cloudflare-workers-ai']))
    expect(providers()).not.toEqual(expect.arrayContaining(['cloudflare-ai-gateway']))
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

describe('toResolvedModelInfo', () => {
  it('reads the context window and the vision property from the catalogue record', () => {
    expect(
      aiPlugin.toResolvedModelInfo('p', '@cf/m', {
        name: '@cf/m',
        description: 'd',
        properties: [
          { property_id: 'context_window', value: '128000' },
          { property_id: 'vision', value: 'true' },
        ],
      }),
    ).toStrictEqual({
      provider: 'p',
      id: '@cf/m',
      name: '@cf/m',
      description: 'd',
      inputModalities: ['text', 'image'],
      context: { contextWindow: 128_000 },
    })
  })

  it('reports text as the only modality when the record claims no vision', () => {
    expect(aiPlugin.toResolvedModelInfo('p', 'm', { name: 'm', properties: [] })).toStrictEqual({
      provider: 'p',
      id: 'm',
      name: 'm',
      inputModalities: ['text'],
    })
  })

  it.each([
    ['a non-numeric value', 'unknown'],
    ['zero', '0'],
    ['a fraction', '1.5'],
    ['a negative', '-8'],
  ])('omits the context when context_window is %s', (_label, value) => {
    expect(
      aiPlugin.toResolvedModelInfo('p', 'm', { properties: [{ property_id: 'context_window', value }] }),
    ).not.toHaveProperty('context')
  })

  it('accepts a context window the catalogue sends as a number', () => {
    expect(
      aiPlugin.toResolvedModelInfo('p', 'm', { properties: [{ property_id: 'context_window', value: 7968 }] })
        .context,
    ).toEqual({ contextWindow: 7968 })
  })

  it('keeps the bare identity for a model the catalogue does not list', () => {
    expect(aiPlugin.toResolvedModelInfo('p', 'm', undefined)).toStrictEqual({
      provider: 'p',
      id: 'm',
      name: 'm',
    })
  })

  it('treats a record without properties as a text model with no known context', () => {
    // Metadata is advisory: a record the catalogue publishes without facts must
    // not fail the model call it describes.
    expect(aiPlugin.toResolvedModelInfo('p', 'm', { name: 'm' })).toStrictEqual({
      provider: 'p',
      id: 'm',
      name: 'm',
      inputModalities: ['text'],
    })
  })
})

describe('resolveModel', () => {
  const record = {
    name: '@cf/m',
    properties: [{ property_id: 'context_window', value: '7968' }],
  }

  it('asks the catalogue for the model by name and reads its facts', async () => {
    const { registered, requests } = harness({}, async () => envelope([{ name: '@cf/other' }, record]))
    await expect(
      registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/m'),
    ).resolves.toStrictEqual({
      provider: 'cloudflare-workers-ai',
      id: '@cf/m',
      name: '@cf/m',
      inputModalities: ['text'],
      context: { contextWindow: 7968 },
    })
    expect(requests[0]!.url).toBe(
      'https://api.test/v4/accounts/a1/ai/models/search?page=1&per_page=100&search=%40cf%2Fm',
    )
  })

  it('keeps the bare identity when the catalogue has no such model', async () => {
    const { registered } = harness({}, async () => envelope([]))
    await expect(
      registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/m'),
    ).resolves.toStrictEqual({
      provider: 'cloudflare-workers-ai',
      id: '@cf/m',
      name: '@cf/m',
    })
  })

  it('looks a model up once per plugin instance', async () => {
    const { registered, requests } = harness({}, async () => envelope([record]))
    await registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/m')
    await registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/m')
    expect(requests).toHaveLength(1)
  })

  it('looks each model up on its own', async () => {
    const { registered, requests } = harness({}, async () => envelope([]))
    await registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/a')
    await registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/b')
    expect(requests).toHaveLength(2)
  })

  it('passes the caller signal to the catalogue lookup', async () => {
    const { registered } = harness({}, async (request) => {
      if (request.signal.aborted) throw request.signal.reason
      return envelope([])
    })
    const controller = new AbortController()
    controller.abort()
    await expect(
      registered[0]!.adapter.resolveModel('cloudflare-workers-ai', '@cf/m', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('listModels', () => {
  it('queries the catalogue when no models are configured', async () => {
    const { registered, requests } = harness({}, async () => envelope([{ name: '@cf/a' }]))
    await expect(registered[0]!.adapter.listModels('cloudflare-workers-ai')).resolves.toEqual([
      { provider: 'cloudflare-workers-ai', id: '@cf/a', name: '@cf/a' },
    ])
    expect(requests[0]!.url).toContain('/ai/models/search?page=1&per_page=100')
  })

  it('walks every page of the catalogue, which reports no total, until a short page', async () => {
    const pages = [
      Array.from({ length: 100 }, (_item, index) => ({ name: `@cf/m${index}` })),
      [{ name: '@cf/last' }],
    ]
    const { registered, requests } = harness({}, async () => envelope(pages.shift() ?? []))
    const models = await registered[0]!.adapter.listModels('cloudflare-workers-ai')
    expect(models).toHaveLength(101)
    expect(models[100]).toEqual({ provider: 'cloudflare-workers-ai', id: '@cf/last', name: '@cf/last' })
    expect(requests.map((request) => new URL(request.url).searchParams.get('page'))).toEqual(['1', '2'])
  })

  it('refuses to present a catalogue the page ceiling cut short as the whole', async () => {
    const full = Array.from({ length: 100 }, (_item, index) => ({ name: `@cf/m${index}` }))
    const { registered } = harness({}, async () => envelope(full), { maxPages: 1 })
    await expect(registered[0]!.adapter.listModels('cloudflare-workers-ai')).rejects.toThrow(
      'the Workers AI catalogue has more than 1 pages of 100 models and the page ceiling (maxPages) stopped the listing; raise maxPages or configure models explicitly',
    )
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

/** Consume a stream to its end, for tests that observe the request rather than the chunks. */
async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of iterable) void chunk
}

describe('endpoint resolution', () => {
  // A minimal completion with content: a finish alone is EMPTY_RESPONSE.
  const stop = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`

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

  // One configuration has one gateway URL; reading it on every model call was
  // a REST round trip per call for a fact that does not change.
  it('reads the gateway url once per plugin instance', async () => {
    const apiRequests: Request[] = []
    const globalFetch = vi.fn(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const { registered } = harness({ gatewayId: 'gw1' }, async (r) => {
        apiRequests.push(r)
        return envelope({ url: 'https://gateway.example/base' })
      })
      const call = () =>
        drain(
          registered[0]!.adapter.stream({ provider: 'cloudflare-ai-gateway', model: '@cf/m', messages: [] }),
        )
      await call()
      await call()
    } finally {
      vi.unstubAllGlobals()
    }
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
    const registered: CloudflareAiAdapter[] = []
    ctx.provide('llm', {
      registerAdapter(_providers: string[], adapter: CloudflareAiAdapter) {
        registered.push(adapter)
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
    const globalFetch = vi.fn(async () => new Response(stop, { status: 200 }))
    vi.stubGlobal('fetch', globalFetch)
    try {
      const call = () =>
        drain(registered[0]!.stream({ provider: 'cloudflare-workers-ai', model: '@cf/m', messages: [] }))
      await call()
      await call()
    } finally {
      vi.unstubAllGlobals()
    }
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

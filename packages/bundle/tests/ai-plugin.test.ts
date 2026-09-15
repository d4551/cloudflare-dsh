import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { FetchLike as MockFetch } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { envelope, harness } from './ai-plugin-support.ts'
import * as aiPlugin from '../src/ai/index.ts'

/** The context shape once the real llm runtime is plugged in. */
interface LlmRuntimeContext extends Context {
  llm: LlmRuntime
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

  it('registers both provider routes on one provider', () => {
    const { registered } = harness()
    expect(registered).toHaveLength(1)
    expect(registered[0]!.providers).toEqual(['cloudflare-workers-ai', 'cloudflare-ai-gateway'])
  })
})

describe('lifecycle', () => {
  it('registers both routes with the real llm runtime and releases them when the fiber unloads', async () => {
    // Runs against the real llm runtime: a registration lives on the calling
    // plugin's fiber, so unloading the plugin unregisters its provider.
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
    const providers = () => (ctx as LlmRuntimeContext).llm.listProviders().map((info) => info.id)

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
      registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/m'),
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
      registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/m'),
    ).resolves.toStrictEqual({
      provider: 'cloudflare-workers-ai',
      id: '@cf/m',
      name: '@cf/m',
    })
  })

  it('looks a model up once per plugin instance', async () => {
    const { registered, requests } = harness({}, async () => envelope([record]))
    await registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/m')
    await registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/m')
    expect(requests).toHaveLength(1)
  })

  it('looks each model up on its own', async () => {
    const { registered, requests } = harness({}, async () => envelope([]))
    await registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/a')
    await registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/b')
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
      registered[0]!.provider.resolveModel('cloudflare-workers-ai', '@cf/m', controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('listModels', () => {
  it('queries the catalogue when no models are configured', async () => {
    const { registered, requests } = harness({}, async () => envelope([{ name: '@cf/a' }]))
    await expect(registered[0]!.provider.listModels('cloudflare-workers-ai')).resolves.toEqual([
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
    const models = await registered[0]!.provider.listModels('cloudflare-workers-ai')
    expect(models).toHaveLength(101)
    expect(models[100]).toEqual({ provider: 'cloudflare-workers-ai', id: '@cf/last', name: '@cf/last' })
    expect(requests.map((request) => new URL(request.url).searchParams.get('page'))).toEqual(['1', '2'])
  })

  it('names the truncation refusal so a caller can tell it from a provider failure', () => {
    expect(new aiPlugin.CatalogueTruncatedError(1)).toMatchObject({ name: 'CatalogueTruncatedError' })
  })

  it('refuses to present a catalogue the page ceiling cut short as the whole', async () => {
    const full = Array.from({ length: 100 }, (_item, index) => ({ name: `@cf/m${index}` }))
    const { registered } = harness({}, async () => envelope(full), { maxPages: 1 })
    await expect(registered[0]!.provider.listModels('cloudflare-workers-ai')).rejects.toThrow(
      'the Workers AI catalogue has more than 1 pages of 100 models and the page ceiling (maxPages) stopped the listing; raise maxPages or configure models explicitly',
    )
  })

  it('uses the configured list without querying the catalogue', async () => {
    const fetchImpl = vi.fn<MockFetch>(async () => envelope([]))
    const { registered } = harness({ models: ['@cf/pinned'] }, fetchImpl)
    await expect(registered[0]!.provider.listModels('cloudflare-workers-ai')).resolves.toEqual([
      {
        provider: 'cloudflare-workers-ai',
        id: '@cf/pinned',
        name: '@cf/pinned',
      },
    ])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

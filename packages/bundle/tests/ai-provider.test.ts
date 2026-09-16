/**
 * The provider's registered surface: the delegation it performs, the error
 * detail it reads back, and the hooks the harness asks it about around a call.
 *
 * The wire half of the same provider — what one model call puts on the wire and
 * what comes back as chunks — is held by `ai-provider-stream.test.ts`; the
 * module this suite imports is the entry the package publishes, so the
 * re-export itself is asserted here too.
 */
import { describe, expect, it } from 'vitest'
import {
  AI_GATEWAY_PROVIDER,
  CloudflareAiProvider,
  WORKERS_AI_PROVIDER,
  readErrorDetail,
} from '../src/ai/index.ts'
import * as providerModule from '../src/ai/provider.ts'
import { MODEL, STOP, TEXT, collect, makeProvider, options, sse } from './ai-provider-support.ts'

describe('readErrorDetail', () => {
  it('reads a Cloudflare envelope error', () => {
    expect(readErrorDetail(400, JSON.stringify({ errors: [{ code: 1, message: 'bad model' }] }))).toBe(
      'HTTP 400 bad model',
    )
  })

  it('reads an OpenAI-style error object', () => {
    expect(
      readErrorDetail(
        429,
        JSON.stringify({ error: { code: 'rate_limit', type: 'requests', message: 'slow' } }),
      ),
    ).toBe('HTTP 429 rate_limit requests slow')
  })

  it('uses the raw body as the detail when it is not JSON', () => {
    expect(readErrorDetail(502, '<html>bad gateway</html>')).toBe('HTTP 502 <html>bad gateway</html>')
  })

  it('reports the status alone for an empty body', () => {
    expect(readErrorDetail(500, '')).toBe('HTTP 500')
  })
})

describe('providerInfo', () => {
  it('labels the known routes', () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    expect(provider.providerInfo('cloudflare-workers-ai')).toEqual({
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
    })
    expect(provider.providerInfo('cloudflare-ai-gateway').name).toBe('Cloudflare AI Gateway')
  })

  it('names an unknown route by its route id', () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    expect(provider.providerInfo('other')).toEqual({ id: 'other', name: 'other' })
  })
})

describe('resolveModel', () => {
  it('delegates to the injected resolver, with the caller signal', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const { provider } = makeProvider(async () => sse(TEXT, STOP), {
      resolveModel: async (providerName, model, signal) => {
        seen.push(signal)
        return { provider: providerName, id: model, name: model, context: { contextWindow: 8 } }
      },
    })
    const signal = new AbortController().signal
    await expect(provider.resolveModel('cloudflare-workers-ai', '@cf/m', signal)).resolves.toEqual({
      provider: 'cloudflare-workers-ai',
      id: '@cf/m',
      name: '@cf/m',
      context: { contextWindow: 8 },
    })
    expect(seen).toEqual([signal])
  })
})

describe('prepareCall', () => {
  // The harness documents prepareCall for dynamic providers: the endpoint of
  // one generation is bound to the stream it hands back, so a later change
  // cannot pair this generation's model facts with another's endpoint.
  it('resolves the endpoint and the model once, and binds the endpoint to the returned stream', async () => {
    let resolutions = 0
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP), {
      resolveEndpoint: async () => {
        resolutions += 1
        return { url: `https://gw.test/generation-${resolutions}`, token: 'tok' }
      },
    })
    const prepared = await provider.prepareCall('cloudflare-workers-ai', '@cf/m')
    expect(prepared.model).toEqual({ provider: 'cloudflare-workers-ai', id: '@cf/m', name: '@cf/m' })
    await collect(prepared.stream(options()))
    await collect(prepared.stream(options()))
    expect(resolutions).toBe(1)
    expect(requests.map((request) => request.url)).toEqual([
      'https://gw.test/generation-1',
      'https://gw.test/generation-1',
    ])
  })

  it('passes the caller signal to both resolutions', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const { provider } = makeProvider(async () => sse(TEXT, STOP), {
      resolveEndpoint: async (_provider, _model, signal) => {
        seen.push(signal)
        return { url: 'https://gw.test/v1/chat/completions', token: 'tok' }
      },
      resolveModel: async (providerName, model, signal) => {
        seen.push(signal)
        return { provider: providerName, id: model, name: model }
      },
    })
    const signal = new AbortController().signal
    await provider.prepareCall('cloudflare-workers-ai', '@cf/m', signal)
    expect(seen).toEqual([signal, signal])
  })
})

describe('listModels', () => {
  it('delegates to the injected lister', async () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    await expect(provider.listModels('cloudflare-workers-ai')).resolves.toEqual([
      { provider: 'cloudflare-workers-ai', id: '@cf/m', name: '@cf/m' },
    ])
  })
})

describe('provider identity', () => {
  it('is an instance of the provider class the harness registers', () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    expect(provider).toBeInstanceOf(CloudflareAiProvider)
  })
})

describe('the retry policy of a registered route', () => {
  // One provider call is one attempt: the harness owns retry, and a second
  // attempt arranged behind it would be billed and logged twice. Cloudflare
  // publishes no route-owned policy beyond the `retry-after` a rate-limited
  // failure already carries, so none is declared and the harness defaults apply.
  it('declares none, for either route', () => {
    const { provider } = makeProvider()
    expect(provider.providerRetryPolicy(WORKERS_AI_PROVIDER)).toBeUndefined()
    expect(provider.providerRetryPolicy(AI_GATEWAY_PROVIDER)).toBeUndefined()
  })
})

describe('the image price of a registered route', () => {
  // Cloudflare prices vision input per token, not per image, so there is no
  // per-image price to declare and the token meter keeps its own estimate.
  it('declares none, for either route', () => {
    const { provider } = makeProvider()
    expect(provider.imageRequestPricing(WORKERS_AI_PROVIDER, MODEL)).toBeUndefined()
    expect(provider.imageRequestPricing(AI_GATEWAY_PROVIDER, MODEL)).toBeUndefined()
  })
})

describe('the published surface', () => {
  // `./ai` is the entry the package publishes, so a host mounting the plugin
  // imports the provider class and the error reader from it rather than from
  // the module that defines them; the two must be the same objects.
  it('re-exports the live provider class and the live error reader', () => {
    expect(CloudflareAiProvider).toBe(providerModule.CloudflareAiProvider)
    expect(readErrorDetail).toBe(providerModule.readErrorDetail)
  })
})

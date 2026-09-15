/**
 * Shared fixtures for the Cloudflare AI provider suites.
 *
 * One source for the stub transport, the base options and the wire payloads,
 * so the behavioural suites assert against the same fixtures instead of two
 * copies drifting.
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CloudflareAiProvider, type CloudflareAiProviderDeps } from '../src/ai/provider.ts'

/** Build an SSE response body from wire chunk payloads. */
export function sse(...payloads: string[]): Response {
  return new Response(payloads.map((p) => `data: ${p}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** A provider wired to a recording transport, overridable per test. */
export function makeProvider(
  fetchImpl: (request: Request) => Promise<Response>,
  over: Partial<CloudflareAiProviderDeps> = {},
): { provider: CloudflareAiProvider; requests: Request[] } {
  const requests: Request[] = []
  const provider = new CloudflareAiProvider({
    resolveEndpoint: async () => ({ url: 'https://gw.test/v1/chat/completions', token: 'tok' }),
    resolveModel: async (providerName, model) => ({ provider: providerName, id: model, name: model }),
    listModels: async () => [{ provider: 'cloudflare-workers-ai', id: '@cf/m', name: '@cf/m' }],
    transmit: async (request) => {
      requests.push(request)
      return fetchImpl(request)
    },
    headerOptions: {},
    streamIdleTimeoutMs: 5000,
    ...over,
  })
  return { provider, requests }
}

/** Generate options for the fixture model, overridable per test. */
export function options(over: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'cloudflare-workers-ai', model: '@cf/m', messages: [], ...over }
}

/** Drain one stream into an array, the way a harness turn consumes it. */
export async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

/** One text delta on the wire. */
export const TEXT = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })

/** A terminal stop on the wire. */
export const STOP = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })

/** A terminal content filter on the wire. */
export const FILTERED = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })

/** Usage without any content on the wire. */
export const USAGE_ONLY = JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 0 } })

/** The finish chunk a content-filtered stream must yield, exactly once. */
export const CONTENT_FILTER_FINISH = {
  type: 'finish',
  reason: {
    kind: 'error',
    failure: {
      message: 'the provider withheld the completion under its content policy',
      code: 'CONTENT_FILTER',
    },
  },
} as const

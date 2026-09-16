/**
 * Shared fixtures for the Cloudflare AI provider suites.
 *
 * One source for the stub transport, the base options and the wire payloads,
 * so the behavioural suites assert against the same fixtures instead of two
 * copies drifting.
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { CloudflareAiProvider, type CloudflareAiProviderDeps } from '../src/ai/provider.ts'

/** The route every fixture provider is registered for. */
const WORKERS_AI_ROUTE = 'cloudflare-workers-ai'

/** The model id every fixture calls. */
export const MODEL = '@cf/m'

/** Build an SSE response body from wire chunk payloads. */
export function sse(...payloads: string[]): Response {
  return new Response(payloads.map((p) => `data: ${p}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/**
 * The transport a fixture gets when the behaviour under test never reaches the
 * wire.
 *
 * Reaching it fails loudly rather than answering: a suite asserting what a
 * request carries cannot pass by way of a request that was made and stubbed
 * away.
 */
const noRequest = async (): Promise<Response> => {
  throw new Error('this fixture is for behaviour that issues no request')
}

/** A provider wired to a recording transport, overridable per test. */
export function makeProvider(
  fetchImpl: (request: Request) => Promise<Response> = noRequest,
  over: Partial<CloudflareAiProviderDeps> = {},
): { provider: CloudflareAiProvider; requests: Request[] } {
  const requests: Request[] = []
  const provider = new CloudflareAiProvider({
    resolveEndpoint: async () => ({ url: 'https://gw.test/v1/chat/completions', token: 'tok' }),
    resolveModel: async (providerName, model) => ({ provider: providerName, id: model, name: model }),
    listModels: async () => [{ provider: WORKERS_AI_ROUTE, id: MODEL, name: MODEL }],
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
  return { provider: WORKERS_AI_ROUTE, model: MODEL, messages: [], ...over }
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

/** A complete text turn ended by the sentinel rather than by the socket. */
export const DONE_TURN = `data: ${TEXT}\n\ndata: [DONE]\n\n`

/** The chunk sequence one text turn with a stop finish must produce, exactly. */
export const EXPECTED_TEXT_TURN = [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'hi' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
  { type: 'finish', reason: { kind: 'stop' } },
] as const

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

/**
 * A response whose body reports whether the provider cancelled it.
 *
 * `close` decides whether the body ends on its own or stays open, so one
 * fixture serves the drained, sentinel-ended and cut-short streams.
 */
export function trackedBody(
  payload: string,
  close: boolean,
): { response: Response; cancelled: () => boolean } {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload))
      if (close) controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  return { response: new Response(body, { status: 200 }), cancelled: () => cancelled }
}

/** A response whose payload arrives split across two transport chunks. */
export function splitBody(full: string): Response {
  const split = Math.floor(full.length / 2)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder()
      controller.enqueue(enc.encode(full.slice(0, split)))
      controller.enqueue(enc.encode(full.slice(split)))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

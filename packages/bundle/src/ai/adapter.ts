/**
 * The Cloudflare model provider.
 *
 * This is the I/O shell: it resolves an endpoint, issues one request, and
 * pipes the response through the pure SSE decoder and transducer. All of the
 * contract logic lives in those modules, which is what keeps this file small
 * enough that nothing important hides in it.
 *
 * Two obligations are visible here rather than delegated:
 *  - the adapter never retries internally — one call is one provider attempt,
 *    because the harness owns retry policy;
 *  - `options.signal` is honoured, and a stream that goes quiet longer than the
 *    configured budget fails as a timeout rather than hanging the turn.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { emptyResponse, idleTimeout, joinDetail, providerError } from './errors.ts'
import { type GatewayHeaderOptions, buildGatewayHeaders } from './headers.ts'
import { buildWireRequest } from './request.ts'
import { SseDecoder, parseEventData } from './sse.ts'
import { StreamTransducer, type WireChunk } from './transducer.ts'

/** Where and how to reach the provider for one call. */
export interface ResolvedEndpoint {
  /** Absolute chat-completions URL. */
  readonly url: string
  /** Bearer token for the request. */
  readonly token: string
}

/** Collaborators the adapter needs. */
export interface CloudflareAiAdapterDeps {
  /** Resolve the endpoint for one provider route and model. */
  resolveEndpoint(provider: string, model: string): Promise<ResolvedEndpoint>
  /** List the models a route can advertise. */
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  /** Injected so the adapter is testable without a network. */
  fetch(request: Request): Promise<Response>
  /** Gateway behaviour applied to every request. */
  readonly headerOptions: GatewayHeaderOptions
  /** How long a stream may go quiet before it is failed. */
  readonly streamIdleTimeoutMs: number
}

/** Human-readable provider metadata, keyed by route. */
const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
}

/** Read the error detail a provider returned, tolerating any body shape. */
export function readErrorDetail(status: number, body: string): string {
  const read = parseEventData<{ errors?: { code?: number; message?: string }[]; error?: { message?: string; code?: string; type?: string } }>(body)
  if (!read.ok) return joinDetail([`HTTP ${status}`, body])
  const parsed = read.value
  const envelope = parsed.errors
  return joinDetail([
    `HTTP ${status}`,
    parsed.error?.code,
    parsed.error?.type,
    parsed.error?.message,
    ...(envelope === undefined ? [] : envelope.map((e) => e.message)),
  ])
}

/**
 * Race a promise against the idle budget.
 *
 * The timer is always cleared, so a slow-but-alive stream never accumulates
 * pending timers.
 */
async function withIdleTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let fail!: (error: unknown) => void
  const guard = new Promise<never>((_resolve, reject) => {
    fail = reject
  })
  const timer = setTimeout(() => {
    fail(idleTimeout(ms))
  }, ms)
  try {
    return await Promise.race([work, guard])
  } finally {
    clearTimeout(timer)
  }
}

export class CloudflareAiAdapter extends LlmAdapter {
  private readonly deps: CloudflareAiAdapterDeps

  constructor(deps: CloudflareAiAdapterDeps) {
    super()
    this.deps = deps
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: PROVIDER_LABELS[provider] ?? provider }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.deps.listModels(provider)
  }

  /**
   * Stream one model call.
   *
   * Yields chunks exactly as the transducer produces them, so the ordering
   * guarantees (`usage` before `finish`, nothing after `finish`) hold here by
   * construction rather than by convention.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const body = buildWireRequest(options)
    const endpoint = await this.deps.resolveEndpoint(options.provider, options.model)
    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${endpoint.token}`,
    })
    for (const [key, value] of Object.entries(
      buildGatewayHeaders(
        { sessionId: options.sessionId, purpose: options.purpose },
        this.deps.headerOptions,
      ),
    )) {
      headers.set(key, value)
    }

    // `null` is the documented "no signal" value, so the caller's signal is
    // forwarded unconditionally rather than through a branch.
    const response = await this.deps.fetch(
      new Request(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal ?? null,
      }),
    )

    if (!response.ok) {
      throw providerError({ status: response.status, detail: readErrorDetail(response.status, await response.text()) })
    }
    if (response.body === null) throw emptyResponse()

    const decoder = new SseDecoder()
    const transducer = new StreamTransducer()
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let produced = false

    try {
      for (;;) {
        // Sequential by nature: each read depends on the previous completing.
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await withIdleTimeout(reader.read(), this.deps.streamIdleTimeoutMs)
        const events = done ? decoder.end() : decoder.push(value)

        for (const event of events) {
          if (event.kind === 'done') {
            yield* transducer.end()
            return
          }
          const read = parseEventData<WireChunk>(event.data)
          if (!read.ok) continue
          for (const chunk of transducer.push(read.value)) {
            produced = true
            yield chunk
          }
        }
        if (done) break
      }
    } finally {
      reader.releaseLock()
    }

    if (!produced && !transducer.isFinished) throw emptyResponse()
    yield* transducer.end()
  }
}

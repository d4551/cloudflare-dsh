/**
 * The Cloudflare model provider.
 *
 * This is the I/O shell: it resolves an endpoint, issues one request, and
 * pipes the response through the pure SSE decoder and transducer. All of the
 * contract logic lives in those modules, which is what keeps this file small
 * enough that nothing important hides in it.
 *
 * Obligations visible here rather than delegated:
 *  - every provider request carries the harness's attribution headers, which
 *    the adapter contract requires on every wire request;
 *  - the adapter never retries internally — one call is one provider attempt,
 *    because the harness owns retry policy;
 *  - `options.signal` is honoured, and a stream that goes quiet longer than the
 *    configured budget fails as a timeout rather than hanging the turn;
 *  - a completion that ends with no content block at all is `EMPTY_RESPONSE`,
 *    however it ended — a finish reason, the `[DONE]` sentinel, or the socket.
 *
 * Two hooks keep the harness defaults on purpose. `providerRetryPolicy` stays
 * undefined because Cloudflare publishes no route-owned retry policy beyond the
 * `retry-after` header a rate-limit failure already carries; and
 * `imageRequestPricing` stays undefined because Cloudflare prices vision input
 * per token, not per image, so there is no per-image price to declare.
 */
import { LlmAdapter, attributionHeaders } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { emptyResponse, idleTimeout, joinDetail, providerError } from './errors.ts'
import { type GatewayHeaderOptions, buildGatewayHeaders } from './headers.ts'
import { buildWireRequest } from './request.ts'
import { SseDecoder, type SseEvent, parseJson } from './sse.ts'
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
  resolveEndpoint(provider: string, model: string, signal?: AbortSignal): Promise<ResolvedEndpoint>
  /** Resolve what the catalogue knows about one exact model. */
  resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>
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
  const read = parseJson<{
    errors?: { code?: number; message?: string }[]
    error?: { message?: string; code?: string; type?: string }
  }>(body)
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

/**
 * The response body as a flat stream of SSE events.
 *
 * A read is one `await` in one call rather than an await inside a loop: the
 * iterator hands out the events already decoded, refilling by recursion when a
 * read produced none (a partial line, or a keep-alive comment). The generator
 * consuming this therefore has a single loop, whose body holds nothing but the
 * chunk contract.
 *
 * `decoder.end()` flushes whatever the last read left buffered, so a provider
 * that omits the trailing blank line still delivers its final event.
 */
function readEvents(
  reader: ReadableStreamDefaultReader<string>,
  decoder: SseDecoder,
  idleTimeoutMs: number,
): AsyncIterable<SseEvent> {
  // Undefined rather than an empty batch: "nothing decoded yet" and "this read
  // decoded nothing" are the same state, and giving it one representation
  // leaves no unobservable initial value behind.
  let pending: SseEvent[] | undefined
  let ended = false

  return {
    [Symbol.asyncIterator]: () => ({
      async next(): Promise<IteratorResult<SseEvent, undefined>> {
        const buffered = pending?.shift()
        if (buffered !== undefined) return { done: false, value: buffered }
        if (ended) return { done: true, value: undefined }
        const { done, value } = await withIdleTimeout(reader.read(), idleTimeoutMs)
        pending = done === true ? decoder.end() : decoder.push(value)
        ended = done === true
        return this.next()
      },
    }),
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

  override async resolveModel(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return this.deps.resolveModel(provider, model, signal)
  }

  /**
   * Bind one call to one generation of connection facts.
   *
   * This adapter is dynamic: the endpoint comes from the account and, on the
   * gateway route, from the API. Resolving it here and handing back a stream
   * bound to it means a settings change between preparation and dispatch can
   * never pair one generation's model metadata with another's endpoint — the
   * case the harness documents `prepareCall` for.
   */
  override async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<PreparedAdapterCall> {
    const [endpoint, info] = await Promise.all([
      this.deps.resolveEndpoint(provider, model, signal),
      this.resolveModel(provider, model, signal),
    ])
    return { model: info, stream: (options) => this.streamTo(endpoint, options) }
  }

  /** Stream one model call, resolving the endpoint for this call alone. */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const endpoint = await this.deps.resolveEndpoint(options.provider, options.model, options.signal)
    yield* this.streamTo(endpoint, options)
  }

  /**
   * Stream one model call against a resolved endpoint.
   *
   * Yields chunks exactly as the transducer produces them, so the ordering
   * guarantees (`usage` before `finish`, nothing after `finish`) hold here by
   * construction rather than by convention.
   */
  private async *streamTo(endpoint: ResolvedEndpoint, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const body = buildWireRequest(options)
    // Attribution first, so nothing below can be read as replacing it.
    const headers = new Headers(attributionHeaders())
    headers.set('content-type', 'application/json')
    headers.set('accept', 'text/event-stream')
    headers.set('authorization', `Bearer ${endpoint.token}`)
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
      throw providerError({
        status: response.status,
        detail: readErrorDetail(response.status, await response.text()),
      })
    }
    if (response.body === null) throw emptyResponse()

    const decoder = new SseDecoder()
    const transducer = new StreamTransducer()
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    const events = readEvents(reader, decoder, this.deps.streamIdleTimeoutMs)
    // Whether any content block opened. Usage alone is not content: a
    // completion that reports tokens and then stops has still said nothing.
    let produced = false

    try {
      for await (const event of events) {
        if (event.kind === 'done') break
        const read = parseJson<WireChunk>(event.data)
        if (!read.ok) continue
        for (const chunk of transducer.push(read.value)) {
          if (chunk.type === 'block-start') produced = true
          yield chunk
        }
      }
    } finally {
      // Cancel rather than merely release the lock: when a consumer abandons
      // the turn mid-stream, cancelling propagates upstream and frees the
      // connection, where releasing the lock alone leaves it open. Cancelling
      // an already-drained stream is a no-op.
      await reader.cancel()
    }

    // The transducer holds the finish back until here, so this is where a
    // completion with no content is judged. A normal finish with nothing before
    // it — or no finish at all — is the degenerate completion the harness
    // classifies rather than yields; an error finish already says what went
    // wrong and is yielded.
    if (!produced && transducer.finishReason?.kind !== 'error') throw emptyResponse()
    yield* transducer.end()
  }
}

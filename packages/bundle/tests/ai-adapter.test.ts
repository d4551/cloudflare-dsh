import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { FetchLike as MockFetch } from '@d4551/dsh-cloudflare-core'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareAiAdapter, readErrorDetail } from '../src/ai/adapter.ts'
import { CONTENT_FILTER_CODE, PROVIDER_ERROR_CODE, RATE_LIMIT_CODE, TIMEOUT_CODE } from '../src/ai/errors.ts'

/** Build an SSE response body from wire chunk payloads. */
function sse(...payloads: string[]): Response {
  return new Response(payloads.map((p) => `data: ${p}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function makeAdapter(
  fetchImpl: (request: Request) => Promise<Response>,
  over: Partial<ConstructorParameters<typeof CloudflareAiAdapter>[0]> = {},
) {
  const requests: Request[] = []
  const adapter = new CloudflareAiAdapter({
    resolveEndpoint: async () => ({ url: 'https://gw.test/v1/chat/completions', token: 'tok' }),
    resolveModel: async (provider, model) => ({ provider, id: model, name: model }),
    listModels: async () => [{ provider: 'cloudflare-workers-ai', id: '@cf/m', name: '@cf/m' }],
    fetch: async (request) => {
      requests.push(request)
      return fetchImpl(request)
    },
    headerOptions: {},
    streamIdleTimeoutMs: 5000,
    ...over,
  })
  return { adapter, requests }
}

function options(over: Record<string, unknown> = {}): GenerateOptions {
  return { provider: 'cloudflare-workers-ai', model: '@cf/m', messages: [], ...over } as GenerateOptions
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

const TEXT = JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })
const STOP = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })
const FILTERED = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })
const USAGE_ONLY = JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 0 } })

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

  it('falls back to the raw body when it is not JSON', () => {
    expect(readErrorDetail(502, '<html>bad gateway</html>')).toBe('HTTP 502 <html>bad gateway</html>')
  })

  it('reports the status alone for an empty body', () => {
    expect(readErrorDetail(500, '')).toBe('HTTP 500')
  })
})

describe('providerInfo', () => {
  it('labels the known routes', () => {
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP))
    expect(adapter.providerInfo('cloudflare-workers-ai')).toEqual({
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
    })
    expect(adapter.providerInfo('cloudflare-ai-gateway').name).toBe('Cloudflare AI Gateway')
  })

  it('falls back to the route id for an unknown route', () => {
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP))
    expect(adapter.providerInfo('other')).toEqual({ id: 'other', name: 'other' })
  })
})

describe('resolveModel', () => {
  it('delegates to the injected resolver, with the caller signal', async () => {
    const seen: (AbortSignal | undefined)[] = []
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP), {
      resolveModel: async (provider, model, signal) => {
        seen.push(signal)
        return { provider, id: model, name: model, context: { contextWindow: 8 } }
      },
    })
    const signal = new AbortController().signal
    await expect(adapter.resolveModel('cloudflare-workers-ai', '@cf/m', signal)).resolves.toEqual({
      provider: 'cloudflare-workers-ai',
      id: '@cf/m',
      name: '@cf/m',
      context: { contextWindow: 8 },
    })
    expect(seen).toEqual([signal])
  })
})

describe('prepareCall', () => {
  // The harness documents prepareCall for dynamic adapters: the endpoint of
  // one generation is bound to the stream it hands back, so a later change
  // cannot pair this generation's model facts with another's endpoint.
  it('resolves the endpoint and the model once, and binds the endpoint to the returned stream', async () => {
    let resolutions = 0
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP), {
      resolveEndpoint: async () => {
        resolutions += 1
        return { url: `https://gw.test/generation-${resolutions}`, token: 'tok' }
      },
    })
    const prepared = await adapter.prepareCall('cloudflare-workers-ai', '@cf/m')
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
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP), {
      resolveEndpoint: async (_provider, _model, signal) => {
        seen.push(signal)
        return { url: 'https://gw.test/v1/chat/completions', token: 'tok' }
      },
      resolveModel: async (provider, model, signal) => {
        seen.push(signal)
        return { provider, id: model, name: model }
      },
    })
    const signal = new AbortController().signal
    await adapter.prepareCall('cloudflare-workers-ai', '@cf/m', signal)
    expect(seen).toEqual([signal, signal])
  })
})

describe('listModels', () => {
  it('delegates to the injected lister', async () => {
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP))
    await expect(adapter.listModels('cloudflare-workers-ai')).resolves.toEqual([
      { provider: 'cloudflare-workers-ai', id: '@cf/m', name: '@cf/m' },
    ])
  })
})

describe('stream', () => {
  it('yields the chunks the transducer produces', async () => {
    const { adapter } = makeAdapter(async () => sse(TEXT, STOP))
    await expect(collect(adapter.stream(options()))).resolves.toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hi' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hi' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('posts to the resolved endpoint with the resolved token', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options()))
    expect(requests[0]!.url).toBe('https://gw.test/v1/chat/completions')
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
    expect(requests[0]!.headers.get('accept')).toBe('text/event-stream')
  })

  // The adapter contract: every provider HTTP request carries the harness's
  // attribution headers, read from the harness rather than copied, so a new
  // harness version changes what is sent without a change here.
  it('sends the harness attribution headers on every provider request', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options()))
    const expected = attributionHeaders()['user-agent']
    expect(expected).toMatch(/\S/)
    expect(requests[0]!.headers.get('user-agent')).toBe(expected)
  })

  it('declares a JSON request body', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options()))
    expect(requests[0]!.headers.get('content-type')).toBe('application/json')
  })

  it('sends the mapped request body', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options({ temperature: 0.5 })))
    const body = JSON.parse(await requests[0]!.text()) as Record<string, unknown>
    expect(body).toMatchObject({ model: '@cf/m', stream: true, temperature: 0.5 })
  })

  // The whole point of the gateway route: gateway logs become filterable by
  // harness session, which is what makes per-session cost real.
  it('stamps the harness session id into cf-aig-metadata', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options({ sessionId: 's1' })))
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1"}')
  })

  it('stamps the auxiliary purpose so housekeeping is attributable separately', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options({ sessionId: 's1', purpose: 'compaction' })))
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1","purpose":"compaction"}')
  })

  it('applies configured gateway header options', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP), {
      headerOptions: { cacheTtlSeconds: 60, skipCache: true, collectLog: false },
    })
    await collect(adapter.stream(options()))
    expect(requests[0]!.headers.get('cf-aig-cache-ttl')).toBe('60')
    expect(requests[0]!.headers.get('cf-aig-skip-cache')).toBe('true')
    expect(requests[0]!.headers.get('cf-aig-collect-log')).toBe('false')
  })

  it('forwards the caller abort signal to the provider request', async () => {
    // The stub honours the signal the way fetch does: a request that arrives
    // already aborted is rejected with the signal's reason. Swallowing the
    // outcome here would leave it unknown whether the caller ever sees the
    // abort.
    const { adapter, requests } = makeAdapter(async (request) => {
      if (request.signal.aborted) throw request.signal.reason
      return sse(TEXT, STOP)
    })
    const controller = new AbortController()
    controller.abort()
    await expect(collect(adapter.stream(options({ signal: controller.signal })))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(requests[0]!.signal.aborted).toBe(true)
  })

  it('sends an unaborted request when the caller supplies no signal', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(TEXT, STOP))
    await collect(adapter.stream(options()))
    expect(requests[0]!.signal.aborted).toBe(false)
  })

  it('handles a payload split across transport chunks', async () => {
    const full = `data: ${TEXT}\n\ndata: ${STOP}\n\n`
    const split = Math.floor(full.length / 2)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder()
        controller.enqueue(enc.encode(full.slice(0, split)))
        controller.enqueue(enc.encode(full.slice(split)))
        controller.close()
      },
    })
    const { adapter } = makeAdapter(async () => new Response(body, { status: 200 }))
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
  })

  it('stops at the [DONE] sentinel', async () => {
    const { adapter } = makeAdapter(
      async () => new Response(`data: ${TEXT}\n\ndata: [DONE]\n\n`, { status: 200 }),
    )
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1)
  })

  it('ignores anything the provider sends after [DONE]', async () => {
    const trailing = JSON.stringify({ choices: [{ delta: { content: 'after' } }] })
    const { adapter } = makeAdapter(
      async () => new Response(`data: ${TEXT}\n\ndata: [DONE]\n\ndata: ${trailing}\n\n`, { status: 200 }),
    )
    const chunks = await collect(adapter.stream(options()))
    const texts = chunks.filter((c) => c.type === 'text-delta').map((c) => (c as { text: string }).text)
    expect(texts).toEqual(['hi'])
  })

  it('delivers a final event the provider left without a trailing newline', async () => {
    // Only the end-of-transport flush can produce this event, and only a real
    // wire finish reason distinguishes it: a stream that simply stops also
    // finishes, but as 'stop'.
    const length = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })
    const { adapter } = makeAdapter(
      async () => new Response(`data: ${TEXT}\n\ndata: ${length}`, { status: 200 }),
    )
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('stops reading at [DONE] even while the provider holds the connection open', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${TEXT}\n\ndata: [DONE]\n\n`))
        // Deliberately never closed: the sentinel, not the socket, ends the turn.
      },
      cancel() {
        cancelled = true
      },
    })
    const { adapter } = makeAdapter(async () => new Response(body, { status: 200 }), {
      streamIdleTimeoutMs: 50,
    })
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(cancelled).toBe(true)
  })

  it('closes a stream that ends without a finish reason', async () => {
    const { adapter } = makeAdapter(async () => sse(TEXT))
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('skips a malformed frame rather than failing the stream', async () => {
    const { adapter } = makeAdapter(
      async () => new Response(`data: {oops\n\ndata: ${TEXT}\n\ndata: ${STOP}\n\n`, { status: 200 }),
    )
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
  })

  it('raises a classified provider error for a failed response', async () => {
    const { adapter } = makeAdapter(
      async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }),
    )
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: PROVIDER_ERROR_CODE })
  })

  it('classifies a rate-limited response', async () => {
    const { adapter } = makeAdapter(async () => new Response('{}', { status: 429 }))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: RATE_LIMIT_CODE })
  })

  // The harness classifies a terminal stop with zero output as EMPTY_RESPONSE
  // instead of yielding an empty assistant message, which would end the turn
  // with nothing for the user or the loop to act on.
  it('classifies a completion that finished with no content as an empty response', async () => {
    const { adapter } = makeAdapter(async () => sse(STOP))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('classifies a [DONE] with no content before it the same way', async () => {
    const { adapter } = makeAdapter(async () => new Response('data: [DONE]\n\n', { status: 200 }))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('does not count token usage as content', async () => {
    const { adapter } = makeAdapter(async () => sse(USAGE_ONLY, STOP))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('yields an error finish for a content filter, after the content that arrived', async () => {
    const { adapter } = makeAdapter(async () => sse(TEXT, FILTERED))
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'the provider withheld the completion under its content policy',
          code: CONTENT_FILTER_CODE,
        },
      },
    })
  })

  it('yields the error finish for a content filter even with no content, since it explains itself', async () => {
    const { adapter } = makeAdapter(async () => sse(FILTERED))
    const chunks = await collect(adapter.stream(options()))
    expect(chunks).toEqual([
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: {
            message: 'the provider withheld the completion under its content policy',
            code: CONTENT_FILTER_CODE,
          },
        },
      },
    ])
  })

  it('raises an empty-response error when the provider sends no body', async () => {
    const { adapter } = makeAdapter(async () => new Response(null, { status: 200 }))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('raises an empty-response error when the stream carries no chunks', async () => {
    const { adapter } = makeAdapter(async () => new Response('', { status: 200 }))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })

  it('fails as a timeout when the stream goes quiet', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${TEXT}\n\n`))
        // never closed: the read after this one will hang
      },
    })
    const { adapter } = makeAdapter(async () => new Response(body, { status: 200 }), {
      streamIdleTimeoutMs: 30,
    })
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: TIMEOUT_CODE })
  })

  // Abandoning a turn mid-stream must free the connection, not leave the
  // provider response hanging open.
  it('cancels the upstream body when the consumer abandons the stream', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${TEXT}\n\n`))
      },
      cancel() {
        cancelled = true
      },
    })
    const { adapter } = makeAdapter(async () => new Response(body, { status: 200 }))
    for await (const chunk of adapter.stream(options())) {
      if (chunk.type === 'text-delta') break
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(cancelled).toBe(true)
  })

  it('cancels the upstream body once a completed stream is drained', async () => {
    let cancelled = false
    const payload = `data: ${TEXT}\n\ndata: ${STOP}\n\n`
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
      cancel() {
        cancelled = true
      },
    })
    const { adapter } = makeAdapter(async () => new Response(body, { status: 200 }))
    const chunks = await collect(adapter.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(cancelled).toBe(false)
  })

  // A leaked idle timer would keep the process alive after a finished stream.
  it('clears the idle timer once the stream completes', async () => {
    vi.useFakeTimers()
    try {
      const { adapter } = makeAdapter(async () => sse(TEXT, STOP))
      await collect(adapter.stream(options()))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the idle timer when the provider fails mid-stream', async () => {
    vi.useFakeTimers()
    try {
      // The body errors after one event, the way a dropped connection does;
      // a stream that merely completed would prove nothing about failure.
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${TEXT}\n\n`))
          controller.error(new Error('connection reset'))
        },
      })
      const { adapter } = makeAdapter(
        async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      )
      await expect(collect(adapter.stream(options()))).rejects.toThrow('connection reset')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // One adapter call is one provider attempt: retry policy belongs to the
  // harness, and retrying here would double-charge and double-log.
  it('never retries internally', async () => {
    const fetchImpl = vi.fn<MockFetch>(async () => new Response('{}', { status: 500 }))
    const { adapter } = makeAdapter(fetchImpl)
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODE,
      failure: { status: 500 },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects an unsupported option before issuing any request', async () => {
    const fetchImpl = vi.fn<MockFetch>(async () => sse(TEXT, STOP))
    const { adapter } = makeAdapter(fetchImpl)
    await expect(collect(adapter.stream(options({ reasoningEffort: 'high' })))).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPTION',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { CloudflareAiAdapter, readErrorDetail } from '../src/ai/adapter.ts'
import { PROVIDER_ERROR_CODE, RATE_LIMIT_CODE, TIMEOUT_CODE } from '../src/ai/errors.ts'

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

describe('readErrorDetail', () => {
  it('reads a Cloudflare envelope error', () => {
    expect(readErrorDetail(400, JSON.stringify({ errors: [{ code: 1, message: 'bad model' }] }))).toBe(
      'HTTP 400 bad model',
    )
  })

  it('reads an OpenAI-style error object', () => {
    expect(
      readErrorDetail(429, JSON.stringify({ error: { code: 'rate_limit', type: 'requests', message: 'slow' } })),
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
    const { adapter } = makeAdapter(async () => sse(STOP))
    expect(adapter.providerInfo('cloudflare-workers-ai')).toEqual({
      id: 'cloudflare-workers-ai',
      name: 'Cloudflare Workers AI',
    })
    expect(adapter.providerInfo('cloudflare-ai-gateway').name).toBe('Cloudflare AI Gateway')
  })

  it('falls back to the route id for an unknown route', () => {
    const { adapter } = makeAdapter(async () => sse(STOP))
    expect(adapter.providerInfo('other')).toEqual({ id: 'other', name: 'other' })
  })
})

describe('listModels', () => {
  it('delegates to the injected lister', async () => {
    const { adapter } = makeAdapter(async () => sse(STOP))
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
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    await collect(adapter.stream(options()))
    expect(requests[0]!.url).toBe('https://gw.test/v1/chat/completions')
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
    expect(requests[0]!.headers.get('accept')).toBe('text/event-stream')
  })

  it('declares a JSON request body', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    await collect(adapter.stream(options()))
    expect(requests[0]!.headers.get('content-type')).toBe('application/json')
  })

  it('sends the mapped request body', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    await collect(adapter.stream(options({ temperature: 0.5 })))
    const body = JSON.parse(await requests[0]!.text()) as Record<string, unknown>
    expect(body).toMatchObject({ model: '@cf/m', stream: true, temperature: 0.5 })
  })

  // The whole point of the gateway route: gateway logs become filterable by
  // harness session, which is what makes per-session cost real.
  it('stamps the harness session id into cf-aig-metadata', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    await collect(adapter.stream(options({ sessionId: 's1' })))
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1"}')
  })

  it('stamps the auxiliary purpose so housekeeping is attributable separately', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    await collect(adapter.stream(options({ sessionId: 's1', purpose: 'compaction' })))
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1","purpose":"compaction"}')
  })

  it('applies configured gateway header options', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP), {
      headerOptions: { cacheTtlSeconds: 60, skipCache: true, collectLog: false },
    })
    await collect(adapter.stream(options()))
    expect(requests[0]!.headers.get('cf-aig-cache-ttl')).toBe('60')
    expect(requests[0]!.headers.get('cf-aig-skip-cache')).toBe('true')
    expect(requests[0]!.headers.get('cf-aig-collect-log')).toBe('false')
  })

  it('forwards the caller abort signal to the provider request', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
    const controller = new AbortController()
    controller.abort()
    await collect(adapter.stream(options({ signal: controller.signal }))).catch(() => undefined)
    expect(requests[0]!.signal.aborted).toBe(true)
  })

  it('sends an unaborted request when the caller supplies no signal', async () => {
    const { adapter, requests } = makeAdapter(async () => sse(STOP))
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
      async () =>
        new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }),
    )
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: PROVIDER_ERROR_CODE })
  })

  it('classifies a rate-limited response', async () => {
    const { adapter } = makeAdapter(async () => new Response('{}', { status: 429 }))
    await expect(collect(adapter.stream(options()))).rejects.toMatchObject({ code: RATE_LIMIT_CODE })
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

  it('clears the idle timer when the provider fails', async () => {
    vi.useFakeTimers()
    try {
      const { adapter } = makeAdapter(async () => sse(TEXT))
      await collect(adapter.stream(options()))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  // One adapter call is one provider attempt: retry policy belongs to the
  // harness, and retrying here would double-charge and double-log.
  it('never retries internally', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }))
    const { adapter } = makeAdapter(fetchImpl)
    await expect(collect(adapter.stream(options()))).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('rejects an unsupported option before issuing any request', async () => {
    const fetchImpl = vi.fn(async () => sse(STOP))
    const { adapter } = makeAdapter(fetchImpl)
    await expect(collect(adapter.stream(options({ reasoningEffort: 'high' })))).rejects.toMatchObject({ code: 'UNSUPPORTED_OPTION' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/**
 * The provider's streaming behaviour: what goes on the wire for one model
 * call, and what comes back as harness chunks.
 *
 * The pure halves of that contract — the wire request mapping, the SSE
 * decoder, the chunk transducer and the error classifier — have suites of
 * their own (`ai-request`, `ai-sse`, `ai-transducer`, `ai-errors`); this
 * suite holds the provider's obligations around them: the headers it stamps,
 * the signals it forwards, the connections it releases, and the
 * empty-response judgement only the provider can make, because only it knows
 * whether any content block ever opened.
 */
import { type Branded, brandString } from '@deepseek-ai/dsh-brand'
import { EMPTY_RESPONSE_CODE, attributionHeaders, type ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collect,
  CONTENT_FILTER_FINISH,
  DONE_TURN,
  EXPECTED_TEXT_TURN,
  FILTERED,
  makeProvider,
  options,
  sse,
  splitBody,
  STOP,
  TEXT,
  TEXT_EVENT,
  TEXT_TURN,
  trackedBody,
  USAGE_ONLY,
} from './ai-provider-support.ts'
import {
  PROVIDER_ERROR_CODE,
  RATE_LIMIT_CODE,
  TIMEOUT_CODE,
  UNSUPPORTED_OPTION_CODE,
} from '../src/ai/errors.ts'

describe('stream', () => {
  it('yields the chunks the transducer produces', async () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    await expect(collect(provider.stream(options()))).resolves.toEqual(EXPECTED_TEXT_TURN)
  })

  it('posts to the resolved endpoint with the resolved token', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options()))
    expect(requests[0]!.url).toBe('https://gw.test/v1/chat/completions')
    expect(requests[0]!.method).toBe('POST')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
    expect(requests[0]!.headers.get('accept')).toBe('text/event-stream')
  })

  // The harness contract: every provider HTTP request carries the harness's
  // attribution headers, read from the harness itself, so a new harness
  // version changes what is sent without a change here.
  it('sends the harness attribution headers on every provider request', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options()))
    const expected = attributionHeaders()['user-agent']
    expect(expected).toMatch(/\S/)
    expect(requests[0]!.headers.get('user-agent')).toBe(expected)
  })

  it('declares a JSON request body', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options()))
    expect(requests[0]!.headers.get('content-type')).toBe('application/json')
  })

  it('sends the mapped request body', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options({ temperature: 0.5 })))
    expect(JSON.parse(await requests[0]!.text())).toMatchObject({
      model: '@cf/m',
      stream: true,
      temperature: 0.5,
    })
  })

  // The whole point of the gateway route: gateway logs become filterable by
  // harness session, which is what makes per-session cost real.
  it('stamps the harness session id into cf-aig-metadata', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options({ sessionId: brandString<Branded<'SessionId'>>('s1') })))
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1"}')
  })

  it('stamps the auxiliary purpose so housekeeping is attributable separately', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(
      provider.stream(options({ sessionId: brandString<Branded<'SessionId'>>('s1'), purpose: 'compaction' })),
    )
    expect(requests[0]!.headers.get('cf-aig-metadata')).toBe('{"sessionId":"s1","purpose":"compaction"}')
  })

  it('applies configured gateway header options', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP), {
      headerOptions: { cacheTtlSeconds: 60, skipCache: true, collectLog: false },
    })
    await collect(provider.stream(options()))
    expect(requests[0]!.headers.get('cf-aig-cache-ttl')).toBe('60')
    expect(requests[0]!.headers.get('cf-aig-skip-cache')).toBe('true')
    expect(requests[0]!.headers.get('cf-aig-collect-log')).toBe('false')
  })

  it('forwards the caller abort signal to the provider request', async () => {
    // The stub honours the signal the way fetch does: a request that arrives
    // already aborted is rejected with the signal's reason. Swallowing the
    // outcome here would leave it unknown whether the caller ever sees the
    // abort.
    const { provider, requests } = makeProvider(async (request) => {
      if (request.signal.aborted) throw request.signal.reason
      return sse(TEXT, STOP)
    })
    const controller = new AbortController()
    controller.abort()
    await expect(collect(provider.stream(options({ signal: controller.signal })))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(requests[0]!.signal.aborted).toBe(true)
  })

  it('sends an unaborted request when the caller supplies no signal', async () => {
    const { provider, requests } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options()))
    expect(requests[0]!.signal.aborted).toBe(false)
  })

  it('handles a payload split across transport chunks', async () => {
    const { provider } = makeProvider(async () => splitBody(TEXT_TURN))
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
  })

  it('stops at the [DONE] sentinel', async () => {
    const { provider } = makeProvider(async () => new Response(DONE_TURN, { status: 200 }))
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(chunks.filter((c) => c.type === 'finish')).toHaveLength(1)
  })

  it('ignores anything the provider sends after [DONE]', async () => {
    const trailing = JSON.stringify({ choices: [{ delta: { content: 'after' } }] })
    const { provider } = makeProvider(
      async () => new Response(`${DONE_TURN}data: ${trailing}\n\n`, { status: 200 }),
    )
    const chunks = await collect(provider.stream(options()))
    const texts = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text)
    expect(texts).toEqual(['hi'])
  })

  it('delivers a final event the provider left without a trailing newline', async () => {
    // Only the end-of-transport flush can produce this event, and only a real
    // wire finish reason distinguishes it: a stream that simply stops also
    // finishes, but as 'stop'.
    const length = JSON.stringify({ choices: [{ delta: {}, finish_reason: 'length' }] })
    const { provider } = makeProvider(
      async () => new Response(`${TEXT_EVENT}data: ${length}`, { status: 200 }),
    )
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('stops reading at [DONE] even while the provider holds the connection open', async () => {
    const { response, cancelled } = trackedBody(DONE_TURN, false)
    const { provider } = makeProvider(async () => response, { streamIdleTimeoutMs: 50 })
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(cancelled()).toBe(true)
  })

  it('closes a stream that ends without a finish reason', async () => {
    const { provider } = makeProvider(async () => sse(TEXT))
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('skips a malformed frame and continues the stream', async () => {
    const { provider } = makeProvider(
      async () => new Response(`data: {oops\n\n${TEXT_TURN}`, { status: 200 }),
    )
    const chunks = await collect(provider.stream(options()))
    expect(chunks.some((c) => c.type === 'text-delta')).toBe(true)
  })

  it('raises a classified provider error for a failed response', async () => {
    const { provider } = makeProvider(
      async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 500 }),
    )
    await expect(collect(provider.stream(options()))).rejects.toMatchObject({ code: PROVIDER_ERROR_CODE })
  })

  it('classifies a rate-limited response', async () => {
    const { provider } = makeProvider(async () => new Response('{}', { status: 429 }))
    await expect(collect(provider.stream(options()))).rejects.toMatchObject({ code: RATE_LIMIT_CODE })
  })

  // The harness classifies a terminal turn with zero output as EMPTY_RESPONSE:
  // yielding an empty assistant message would end the turn with nothing for
  // the user or the loop to act on. Every way a completion can say nothing —
  // a bare finish, the sentinel, usage alone, an empty body, no body at all —
  // lands in the same classification.
  it.each([
    ['a finish with no content before it', async () => sse(STOP)],
    ['a [DONE] with no content before it', async () => new Response('data: [DONE]\n\n', { status: 200 })],
    ['usage alone with no content', async () => sse(USAGE_ONLY, STOP)],
    ['a 200 with no body', async () => new Response(null, { status: 200 })],
    ['a 200 whose stream carries no events', async () => new Response('', { status: 200 })],
  ])('classifies %s as an empty response', async (_label, respond) => {
    const { provider } = makeProvider(respond)
    await expect(collect(provider.stream(options()))).rejects.toMatchObject({
      code: EMPTY_RESPONSE_CODE,
    })
  })

  it('yields an error finish for a content filter, after the content that arrived', async () => {
    const { provider } = makeProvider(async () => sse(TEXT, FILTERED))
    const chunks = await collect(provider.stream(options()))
    expect(chunks.at(-1)).toEqual(CONTENT_FILTER_FINISH)
  })

  it('yields the error finish for a content filter even with no content, since it explains itself', async () => {
    const { provider } = makeProvider(async () => sse(FILTERED))
    await expect(collect(provider.stream(options()))).resolves.toEqual([CONTENT_FILTER_FINISH])
  })

  it('fails as a timeout when the stream goes quiet', async () => {
    const { response } = trackedBody(TEXT_EVENT, false)
    const { provider } = makeProvider(async () => response, { streamIdleTimeoutMs: 30 })
    await expect(collect(provider.stream(options()))).rejects.toMatchObject({ code: TIMEOUT_CODE })
  })

  // Abandoning a turn mid-stream must free the connection, not leave the
  // provider response hanging open.
  it('cancels the upstream body when the consumer abandons the stream', async () => {
    const { response, cancelled } = trackedBody(TEXT_EVENT, false)
    const { provider } = makeProvider(async () => response)
    for await (const chunk of provider.stream(options())) {
      if (chunk.type === 'text-delta') break
    }
    // Breaking the loop awaits the iterator's return, and the return cancels
    // the reader, so the cancellation has settled by the time the loop ends.
    expect(cancelled()).toBe(true)
  })

  // The other half of the same release contract: a provider that released the
  // connection after each event would cut a live turn short, and one that never
  // released it would leave the response open when the consumer stops reading.
  it('holds the upstream body open while the turn is still being read, then releases it on return', async () => {
    const { response, cancelled } = trackedBody(TEXT_TURN, false)
    const { provider } = makeProvider(async () => response)
    const turn = provider.stream(options())[Symbol.asyncIterator]()
    await expect(turn.next()).resolves.toMatchObject({ value: { type: 'block-start' } })
    expect(cancelled()).toBe(false)
    await expect(turn.return?.()).resolves.toMatchObject({ done: true })
    expect(cancelled()).toBe(true)
  })

  // One provider call is one attempt: retry policy belongs to the harness,
  // and retrying here would double-charge and double-log.
  it('never retries internally', async () => {
    const transmit = vi.fn<(request: Request) => Promise<Response>>(
      async () => new Response('{}', { status: 500 }),
    )
    const { provider } = makeProvider(transmit)
    await expect(collect(provider.stream(options()))).rejects.toMatchObject({
      code: PROVIDER_ERROR_CODE,
      failure: { status: 500 },
    })
    expect(transmit).toHaveBeenCalledTimes(1)
  })

  it('rejects an unsupported option before issuing any request', async () => {
    const transmit = vi.fn<(request: Request) => Promise<Response>>(async () => sse(TEXT, STOP))
    const { provider } = makeProvider(transmit)
    await expect(
      collect(provider.stream(options({ reasoningEffort: brandString<ReasoningEffortId>('high') }))),
    ).rejects.toMatchObject({
      code: UNSUPPORTED_OPTION_CODE,
    })
    expect(transmit).not.toHaveBeenCalled()
  })
})

describe('idle timer hygiene', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // A leaked idle timer would keep the process alive after a finished stream.
  it('clears the idle timer once the stream completes', async () => {
    const { provider } = makeProvider(async () => sse(TEXT, STOP))
    await collect(provider.stream(options()))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears the idle timer when the provider fails mid-stream', async () => {
    // The body errors after one event, the way a dropped connection does;
    // a stream that merely completed would prove nothing about failure.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(TEXT_EVENT))
        controller.error(new Error('connection reset'))
      },
    })
    const { provider } = makeProvider(
      async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    await expect(collect(provider.stream(options()))).rejects.toThrow('connection reset')
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  CloudflareClient,
  TRANSPORT_FAILURE_STATUS,
  readEnvelope,
  realSleep,
  statusOfError,
} from '../src/client.ts'
import {
  CloudflareAuthError,
  CloudflareError,
  CloudflareNotFoundError,
  isRetryableStatus,
} from '../src/errors.ts'
import type { NextPageQuery } from '../src/paginate.ts'
import type { CloudflareEnvelope } from '../src/types.ts'

const REF = 'CLOUDFLARE_API_TOKEN'

/** A cursor stepper for the walk tests: the walk is under test here, not any production stepper. */
const byCursor = (envelope: Pick<CloudflareEnvelope, 'result_info'>): NextPageQuery => {
  const cursor = envelope.result_info?.cursor
  return cursor === undefined || cursor === '' ? null : { cursor }
}
const retry = { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 }

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function ok<T>(result: T, info?: CloudflareEnvelope['result_info']): CloudflareEnvelope<T> {
  return info === undefined
    ? { success: true, errors: [], result }
    : { success: true, errors: [], result, result_info: info }
}

function makeClient(
  fetchImpl: (req: Request) => Promise<Response>,
  over: Partial<{ maxPages: number; requestTimeoutMs: number }> = {},
) {
  const requests: Request[] = []
  const client = new CloudflareClient({
    credentials: { resolve: () => 'tok' },
    apiTokenRef: REF,
    baseUrl: 'https://api.test/client/v4',
    retry,
    maxPages: over.maxPages ?? 10,
    requestTimeoutMs: over.requestTimeoutMs ?? 30_000,
    fetch: async (req) => {
      requests.push(req)
      return fetchImpl(req)
    },
    sleep: async () => {},
    random: () => 1,
  })
  return { client, requests }
}

/**
 * A fetch that never settles on its own, the way a hung connection behaves.
 *
 * A real fetch rejects immediately on an already-aborted signal rather than
 * waiting for an event that has been and gone, so this does too.
 */
function hang(request: Request): Promise<Response> {
  return new Promise((_resolve, reject) => {
    // A real fetch rejects with the signal's own reason, which is what
    // distinguishes a timeout (`TimeoutError`, transient) from a caller
    // cancelling (`AbortError`, final). Inventing an error here would have hid
    // that distinction from every test below.
    const fail = (): void => {
      reject(request.signal.reason)
    }
    if (request.signal.aborted) fail()
    else request.signal.addEventListener('abort', fail)
  })
}

describe('statusOfError', () => {
  it('reads the status from a Cloudflare error', () => {
    expect(statusOfError(new CloudflareError('x', 503))).toBe(503)
  })

  it('treats a transport failure as retryable', () => {
    // `fetch` reports a reset connection or a DNS failure as a bare TypeError
    // with no status. It is the commonest transient failure there is, and it
    // was previously classified as permanent.
    expect(statusOfError(new TypeError('fetch failed'))).toBe(TRANSPORT_FAILURE_STATUS)
    expect(isRetryableStatus(TRANSPORT_FAILURE_STATUS)).toBe(true)
  })

  it('does not retry an abort, which is the caller deciding to stop', () => {
    // Aborting a fetch throws a DOMException, not a TypeError.
    expect(statusOfError(new DOMException('aborted', 'AbortError'))).toBe(0)
  })

  it('reports zero for anything else so it is not retried', () => {
    expect(statusOfError(new Error('boom'))).toBe(0)
    expect(statusOfError('nope')).toBe(0)
  })
})

describe('requestText failure classification', () => {
  it('uses the Cloudflare code from an error body, not just the status', async () => {
    // 10000 is unauthorized regardless of the status class, and requestText
    // previously threw the body away before classifying.
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        {
          status: 500,
        },
      ),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toBeInstanceOf(
      CloudflareAuthError,
    )
  })

  it('carries the credential reference and the envelope code', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        {
          status: 403,
        },
      ),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      credentialRef: REF,
      message: '[10000] nope',
    })
  })

  it('still classifies by status when the error body is not an envelope, and keeps the body', async () => {
    const { client } = makeClient(async () => new Response('<html>gateway error</html>', { status: 404 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareNotFoundError',
      message: 'HTTP 404 without a Cloudflare envelope: <html>gateway error</html>',
    })
  })
})

describe('requestText retry', () => {
  it('retries a transient failure, since a KV value read is a request like any other', () => {
    // `requestText` called `#send` directly, so `maxRetries` governed `request`
    // alone and `cloudflare_kv_get` had no retries at all.
    let call = 0
    const { client } = makeClient(async () => {
      call += 1
      if (call === 1) return new Response('busy', { status: 503 })
      return new Response('stored-value', { status: 200 })
    })
    return expect(client.requestText({ method: 'GET', path: '/x' })).resolves.toBe('stored-value')
  })
})

describe('request cancellation', () => {
  it('aborts an attempt that outruns the configured budget', async () => {
    // Without this the request hangs for as long as the connection does, and
    // `requestTimeoutMs` is a setting that does nothing.
    const { client } = makeClient(hang, { requestTimeoutMs: 10 })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('retries a timed-out attempt, because a deadline is a transient failure', async () => {
    // The budget is per attempt. A timeout that ends the whole operation would
    // make the per-attempt deadline a cap on the operation instead.
    const fetchImpl = vi.fn(hang)
    const { client } = makeClient(fetchImpl, { requestTimeoutMs: 10 })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1)
  })

  it('aborts an attempt when the caller cancels', async () => {
    const controller = new AbortController()
    const { client } = makeClient((request) => {
      controller.abort()
      return hang(request)
    })
    await expect(
      client.request({ method: 'GET', path: '/x', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not retry a caller abort, which is a decision rather than a failure', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn((request: Request) => {
      controller.abort()
      return hang(request)
    })
    const { client } = makeClient(fetchImpl)
    await expect(
      client.request({ method: 'GET', path: '/x', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('readEnvelope', () => {
  it('parses a JSON envelope', async () => {
    await expect(readEnvelope(json(ok({ a: 1 })))).resolves.toEqual({
      ok: true,
      envelope: ok({ a: 1 }),
    })
  })

  it('reports failure for an empty body', async () => {
    await expect(readEnvelope(new Response(null, { status: 204 }))).resolves.toEqual({ ok: false, body: '' })
  })

  it('reports failure for a non-JSON body rather than throwing SyntaxError', async () => {
    await expect(readEnvelope(new Response('<html>502</html>', { status: 502 }))).resolves.toEqual({
      ok: false,
      body: '<html>502</html>',
    })
  })
})

describe('realSleep', () => {
  // Driven by fake timers rather than the wall clock. A tolerance below the
  // requested delay makes the name a claim the assertion does not hold — a
  // sleep of 20ms passed a test named for 25 — and a real clock makes the
  // result depend on how loaded the machine is.
  it('resolves once the requested delay has elapsed, and not a tick before', async () => {
    vi.useFakeTimers()
    try {
      let resolved = false
      const sleeping = (async () => {
        await realSleep(25)
        resolved = true
      })()
      await vi.advanceTimersByTimeAsync(24)
      expect(resolved).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await sleeping
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('CloudflareClient.request', () => {
  it('exposes the credential reference it authenticates with', () => {
    const { client } = makeClient(async () => json(ok(null)))
    expect(client.apiTokenRef).toBe(REF)
  })

  it('returns the unwrapped result', async () => {
    const { client } = makeClient(async () => json(ok({ id: 'db1' })))
    await expect(client.request({ method: 'GET', path: '/accounts' })).resolves.toEqual({ id: 'db1' })
  })

  it('sends the resolved bearer token', async () => {
    const { client, requests } = makeClient(async () => json(ok(null)))
    await client.request({ method: 'GET', path: '/accounts' })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
  })

  it('builds the URL from base, path and query', async () => {
    const { client, requests } = makeClient(async () => json(ok(null)))
    await client.request({
      method: 'GET',
      path: '/accounts',
      query: { per_page: 5 },
    })
    expect(requests[0]!.url).toBe('https://api.test/client/v4/accounts?per_page=5')
  })

  it('defaults the base URL when none is configured', async () => {
    const requests: Request[] = []
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => 'tok' },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async (req) => {
        requests.push(req)
        return json(ok(null))
      },
    })
    await client.request({ method: 'GET', path: '/accounts' })
    expect(requests[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts')
  })

  it('throws a typed error for an error envelope', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 7003, message: 'no route' }], messages: [], result: null },
        { status: 400 },
      ),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow('[7003] no route')
  })

  it('maps an unauthenticated response to an auth error', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'bad token' }], messages: [], result: null },
        { status: 403 },
      ),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })

  it('maps a 404 to a not-found error', async () => {
    const { client } = makeClient(async () =>
      json({ success: false, errors: [], messages: [], result: null }, { status: 404 }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareNotFoundError)
  })

  it('a per-request budget replaces the client default for that attempt', async () => {
    const { client } = makeClient(hang, { requestTimeoutMs: 30_000 })
    await expect(client.request({ method: 'GET', path: '/x', timeoutMs: 10 })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('a per-request budget may exceed the client default, which is what a long-running tool needs', async () => {
    const slow = async (): Promise<Response> => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 40)
      })
      return json({ success: true, errors: [], messages: [], result: 'late' })
    }
    const { client } = makeClient(slow, { requestTimeoutMs: 10 })
    await expect(client.request({ method: 'GET', path: '/x', timeoutMs: 500 })).resolves.toBe('late')
  })

  it('classifies a non-JSON error body by status and carries the body', async () => {
    const { client } = makeClient(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareError',
      status: 502,
      message: 'HTTP 502 without a Cloudflare envelope: <html>bad gateway</html>',
    })
  })

  it('carries the retry hint from a rate-limited non-JSON response', async () => {
    const { client } = makeClient(
      async () => new Response('', { status: 429, headers: { 'retry-after': '3' } }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareRateLimitError',
      retryAfterMs: 3000,
    })
  })

  it('rejects a 2xx response whose body is not an envelope, quoting it', async () => {
    const { client } = makeClient(async () => new Response('<html>hi</html>', { status: 200 }))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareError',
      status: 200,
      message: 'HTTP 200 without a Cloudflare envelope: <html>hi</html>',
    })
  })

  it('carries the retry hint from a rate-limited JSON envelope', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 971, message: 'slow' }], messages: [], result: null },
        {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '7' },
        },
      ),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareRateLimitError',
      retryAfterMs: 7000,
    })
  })

  it('throws when success is false on a 2xx status', async () => {
    const { client } = makeClient(async () =>
      json({
        success: false,
        errors: [{ code: 1, message: 'soft fail' }],
        messages: [],
        result: null,
      }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow('[1] soft fail')
  })

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0
    const { client } = makeClient(async () => {
      calls += 1
      return calls === 1
        ? json({ success: false, errors: [], messages: [], result: null }, { status: 503 })
        : json(ok('done'))
    })
    await expect(client.request({ method: 'GET', path: '/x' })).resolves.toBe('done')
    expect(calls).toBe(2)
  })

  it('does not retry a client error', async () => {
    let calls = 0
    const { client } = makeClient(async () => {
      calls += 1
      return json({ success: false, errors: [], messages: [], result: null }, { status: 400 })
    })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
    expect(calls).toBe(1)
  })

  it('gives up after the retry budget', async () => {
    let calls = 0
    const { client } = makeClient(async () => {
      calls += 1
      return json({ success: false, errors: [], messages: [], result: null }, { status: 500 })
    })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
    expect(calls).toBe(retry.maxRetries + 1)
  })

  it('re-resolves the credential on every attempt so rotation is picked up', async () => {
    const resolve = vi.fn(() => 'tok')
    let calls = 0
    const client = new CloudflareClient({
      credentials: { resolve },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => {
        calls += 1
        return calls === 1
          ? json({ success: false, errors: [], messages: [], result: null }, { status: 500 })
          : json(ok(1))
      },
      sleep: async () => {},
      random: () => 1,
    })
    await client.request({ method: 'GET', path: '/x' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => json(ok(null)),
    })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })

  it('uses real timers by default without hanging', async () => {
    let calls = 0
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => 'tok' },
      apiTokenRef: REF,
      retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => {
        calls += 1
        return calls === 1
          ? json({ success: false, errors: [], messages: [], result: null }, { status: 500 })
          : json(ok('ok'))
      },
    })
    await expect(client.request({ method: 'GET', path: '/x' })).resolves.toBe('ok')
    expect(calls).toBe(2)
  })
})

describe('CloudflareClient.resolveToken', () => {
  it('returns the resolved token for callers on other Cloudflare hosts', async () => {
    const { client } = makeClient(async () => json(ok(null)))
    await expect(client.resolveToken()).resolves.toBe('tok')
  })

  it('resolves per call so a rotated credential is picked up', async () => {
    const values = ['first', 'second']
    let i = 0
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => values[i++] },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => json(ok(null)),
    })
    await expect(client.resolveToken()).resolves.toBe('first')
    await expect(client.resolveToken()).resolves.toBe('second')
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => json(ok(null)),
    })
    await expect(client.resolveToken()).rejects.toThrow(CloudflareAuthError)
  })
})

describe('CloudflareClient.requestText', () => {
  it('returns the raw body for endpoints that do not use an envelope', async () => {
    const { client } = makeClient(async () => new Response('stored-value', { status: 200 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).resolves.toBe('stored-value')
  })

  it('returns an empty body unchanged', async () => {
    const { client } = makeClient(async () => new Response('', { status: 200 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).resolves.toBe('')
  })

  it('classifies a failure by status', async () => {
    const { client } = makeClient(async () => new Response('nope', { status: 404 }))
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareNotFoundError)
  })

  it('carries the retry hint on a rate-limited raw response', async () => {
    const { client } = makeClient(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': '4' } }),
    )
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      retryAfterMs: 4000,
    })
  })

  it('sends the resolved bearer token', async () => {
    const { client, requests } = makeClient(async () => new Response('v', { status: 200 }))
    await client.requestText({ method: 'GET', path: '/x' })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer tok')
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => new Response('v'),
    })
    await expect(client.requestText({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })
})

describe('CloudflareClient.requestEnvelope', () => {
  it('returns the whole envelope including result_info', async () => {
    const { client } = makeClient(async () => json(ok([1, 2], { cursor: 'c1' })))
    const env = await client.requestEnvelope({ method: 'GET', path: '/x' })
    expect(env.result_info).toEqual({ cursor: 'c1' })
  })

  it('throws on an error envelope', async () => {
    const { client } = makeClient(async () =>
      json(
        {
          success: false,
          errors: [{ code: 9, message: 'nope' }],
          messages: [],
          result: null,
        },
        { status: 400 },
      ),
    )
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow('[9] nope')
  })

  it('throws when the body is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('nope', { status: 500 }))
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      sleep: async () => {},
      random: () => 1,
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      requestTimeoutMs: 30_000,
      fetch: async () => json(ok(null)),
    })
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })
})

describe('CloudflareClient.list', () => {
  it('walks pages via the cursor', async () => {
    const pages = [json(ok(['a'], { cursor: 'c1' })), json(ok(['b'], { cursor: '' }))]
    let i = 0
    const { client, requests } = makeClient(async () => pages[i++]!)
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toEqual({
      items: ['a', 'b'],
      truncated: false,
      pages: 2,
    })
    expect(requests[1]!.url).toBe('https://api.test/client/v4/x?cursor=c1')
  })

  it('merges the spec query with the page overlay', async () => {
    const pages = [json(ok(['a'], { cursor: 'c1' })), json(ok(['b'], { cursor: '' }))]
    let i = 0
    const { client, requests } = makeClient(async () => pages[i++]!)
    await client.listAll({ method: 'GET', path: '/x', query: { per_page: 2 } }, byCursor)
    expect(requests[1]!.url).toContain('per_page=2')
    expect(requests[1]!.url).toContain('cursor=c1')
  })

  it('honours the maxPages ceiling', async () => {
    const { client, requests } = makeClient(async () => json(ok(['x'], { cursor: 'always' })), {
      maxPages: 3,
    })
    // Truncated: the server still offered a cursor when the ceiling hit.
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toEqual({
      items: ['x', 'x', 'x'],
      truncated: true,
      pages: 3,
    })
    expect(requests).toHaveLength(3)
  })

  it('propagates an error mid-walk once the retry budget is spent', async () => {
    // A fresh Response per call: a walk now retries, so a fixed queue of two
    // would run out and fail for the wrong reason.
    const failure = (): Response =>
      json(
        {
          success: false,
          errors: [{ code: 2, message: 'mid' }],
          messages: [],
          result: null,
        },
        { status: 500 },
      )
    let call = 0
    const { client } = makeClient(async () => (call++ === 0 ? json(ok(['a'], { cursor: 'c1' })) : failure()))
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).rejects.toThrow('[2] mid')
  })

  it('retries a transient failure mid-walk instead of abandoning the page', async () => {
    // `listAll` used to bypass the retry policy entirely, so a single 500 on
    // page two ended the walk while the seam advertised retry.
    let call = 0
    const { client } = makeClient(async () => {
      call += 1
      if (call === 1) return json(ok(['a'], { cursor: 'c1' }))
      if (call === 2) return json({ success: false, errors: [], messages: [], result: null }, { status: 503 })
      return json(ok(['b'], { cursor: '' }))
    })
    await expect(client.listAll({ method: 'GET', path: '/x' }, byCursor)).resolves.toMatchObject({
      items: ['a', 'b'],
    })
  })
})

describe('CloudflareClient.requestBytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

  it('returns the bytes and the media type the server declared', async () => {
    const { client } = makeClient(
      async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x', accept: 'image/png' })).resolves.toEqual({
      bytes: png,
      contentType: 'image/png',
    })
  })

  it('reports a missing content type as null rather than guessing one', async () => {
    const { client } = makeClient(async () => new Response(png, { status: 200 }))
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).resolves.toMatchObject({
      contentType: null,
    })
  })

  it('sends the accept type the spec names', async () => {
    const { client, requests } = makeClient(async () => new Response(png, { status: 200 }))
    await client.requestBytes({ method: 'POST', path: '/x', accept: 'image/jpeg' })
    expect(requests[0]!.headers.get('accept')).toBe('image/jpeg')
  })

  it('classifies a failure from the envelope code when the error body carries one', async () => {
    const { client } = makeClient(async () =>
      json(
        { success: false, errors: [{ code: 10000, message: 'nope' }], messages: [], result: null },
        { status: 500 },
      ),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareAuthError',
      credentialRef: REF,
      message: '[10000] nope',
    })
  })

  it('classifies a failure by status and keeps a body that is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('<html>gateway error</html>', { status: 404 }))
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareNotFoundError',
      message: 'HTTP 404 without a Cloudflare envelope: <html>gateway error</html>',
    })
  })

  it('carries the retry hint on a rate-limited response', async () => {
    const { client } = makeClient(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': '4' } }),
    )
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareRateLimitError',
      retryAfterMs: 4000,
    })
  })

  it('retries a transient failure like every other request', async () => {
    let call = 0
    const { client } = makeClient(async () => {
      call += 1
      if (call === 1) return new Response('busy', { status: 503 })
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    })
    await expect(client.requestBytes({ method: 'POST', path: '/x' })).resolves.toMatchObject({ bytes: png })
    expect(call).toBe(2)
  })
})

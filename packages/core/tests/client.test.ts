import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { FetchLike } from '../src/client.ts'
import { realSleep } from '../src/client.ts'
import type { CredentialResolver } from '../src/credentials.ts'
import { CloudflareAuthError, CloudflareError, CloudflareNotFoundError } from '../src/errors.ts'
import { flakyTransport, honouring, json, makeClient, ok, REF, RETRY } from './support/client-fixture.ts'

/** A transport that answers after a real delay, past the shortest budgets. */
const slow = async (): Promise<Response> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 40)
  })
  return json({ success: true, errors: [], messages: [], result: 'late' })
}

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
    const { client, requests } = makeClient(async () => json(ok(null)), {
      baseUrl: 'https://api.test/client/v4',
    })
    await client.request({
      method: 'GET',
      path: '/accounts',
      query: { per_page: 5 },
    })
    expect(requests[0]!.url).toBe('https://api.test/client/v4/accounts?per_page=5')
  })

  it('defaults the base URL when none is configured', async () => {
    const { client, requests } = makeClient(async () => json(ok(null)))
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
    const { client } = makeClient(honouring, { requestTimeoutMs: 30_000 })
    await expect(client.request({ method: 'GET', path: '/x', timeoutMs: 10 })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('a per-request budget may exceed the client default, which is what a long-running tool needs', async () => {
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
    const { client, requests } = makeClient(flakyTransport(503, 1, 'done'))
    await expect(client.request({ method: 'GET', path: '/x' })).resolves.toBe('done')
    expect(requests).toHaveLength(2)
  })

  it('does not retry a client error', async () => {
    const { client, requests } = makeClient(flakyTransport(400, 2, 'unused'))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
    expect(requests).toHaveLength(1)
  })

  it('gives up after the retry budget', async () => {
    const { client, requests } = makeClient(flakyTransport(500, RETRY.maxRetries + 1, 'unused'))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
    expect(requests).toHaveLength(RETRY.maxRetries + 1)
  })

  it('re-resolves the credential on every attempt so rotation is picked up', async () => {
    const resolve = vi.fn<CredentialResolver['resolve']>(() => 'tok')
    const { client } = makeClient(flakyTransport(500, 1, 1), { credentials: { resolve } })
    await client.request({ method: 'GET', path: '/x' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('fails loud when the credential is missing', async () => {
    const { client } = makeClient(async () => json(ok(null)), {
      credentials: { resolve: () => undefined },
    })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })

  it('uses real timers by default without hanging', async () => {
    const { client, requests } = makeClient(flakyTransport(500, 1, 'ok'), {
      retryPolicy: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
    })
    await expect(client.request({ method: 'GET', path: '/x' })).resolves.toBe('ok')
    expect(requests).toHaveLength(2)
  })
})

describe('request cancellation', () => {
  it('aborts an attempt that outruns the configured budget', async () => {
    // Without this the request hangs for as long as the connection does, and
    // `requestTimeoutMs` is a setting that does nothing.
    const { client } = makeClient(honouring, { requestTimeoutMs: 10 })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
  })

  it('retries a timed-out attempt, because a deadline is a transient failure', async () => {
    // The budget is per attempt. A timeout that ends the whole operation would
    // make the per-attempt deadline a cap on the operation instead.
    const fetchImpl = vi.fn<FetchLike>(honouring)
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
      return honouring(request)
    })
    await expect(
      client.request({ method: 'GET', path: '/x', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not retry a caller abort, which is a decision rather than a failure', async () => {
    const controller = new AbortController()
    const fetchImpl = vi.fn<FetchLike>((request: Request) => {
      controller.abort()
      return honouring(request)
    })
    const { client } = makeClient(fetchImpl)
    await expect(
      client.request({ method: 'GET', path: '/x', signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('realSleep', () => {
  // Driven by fake timers rather than the wall clock. A tolerance below the
  // requested delay makes the name a claim the assertion does not hold — a
  // sleep of 20ms passed a test named for 25 — and a real clock makes the
  // result depend on how loaded the machine is.
  it('resolves once the requested delay has elapsed, and not a tick before', async () => {
    vi.useFakeTimers()
    onTestFinished(() => {
      vi.useRealTimers()
    })
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
  })
})

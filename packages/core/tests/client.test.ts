import { describe, expect, it, vi } from 'vitest'
import { CloudflareClient, accountScope, readEnvelope, realSleep, statusOfError } from '../src/client.ts'
import { CloudflareAuthError, CloudflareError, CloudflareNotFoundError } from '../src/errors.ts'
import { nextCursorQuery } from '../src/paginate.ts'
import type { CloudflareEnvelope } from '../src/types.ts'

const REF = 'CLOUDFLARE_API_TOKEN'
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
    ? { success: true, errors: [], messages: [], result }
    : { success: true, errors: [], messages: [], result, result_info: info }
}

function makeClient(fetchImpl: (req: Request) => Promise<Response>, over: Partial<{ maxPages: number }> = {}) {
  const requests: Request[] = []
  const client = new CloudflareClient({
    credentials: { resolve: () => 'tok' },
    apiTokenRef: REF,
    baseUrl: 'https://api.test/client/v4',
    retry,
    maxPages: over.maxPages ?? 10,
    fetch: async (req) => {
      requests.push(req)
      return fetchImpl(req)
    },
    sleep: async () => {},
    random: () => 1,
  })
  return { client, requests }
}

describe('statusOfError', () => {
  it('reads the status from a Cloudflare error', () => {
    expect(statusOfError(new CloudflareError('x', 503))).toBe(503)
  })

  it('reports zero for anything else so it is not retried', () => {
    expect(statusOfError(new Error('boom'))).toBe(0)
    expect(statusOfError('nope')).toBe(0)
  })
})

describe('readEnvelope', () => {
  it('parses a JSON envelope', async () => {
    await expect(readEnvelope(json(ok({ a: 1 })))).resolves.toEqual({ ok: true, envelope: ok({ a: 1 }) })
  })

  it('reports failure for an empty body', async () => {
    await expect(readEnvelope(new Response(null, { status: 204 }))).resolves.toEqual({ ok: false })
  })

  it('reports failure for a non-JSON body rather than throwing SyntaxError', async () => {
    await expect(readEnvelope(new Response('<html>502</html>', { status: 502 }))).resolves.toEqual({ ok: false })
  })
})

describe('realSleep', () => {
  it('resolves only after the requested delay has elapsed', async () => {
    const started = Date.now()
    await realSleep(25)
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
  })
})

describe('accountScope', () => {
  it('builds an account scope', () => {
    expect(accountScope('a1')).toEqual({ kind: 'account', id: 'a1' })
  })

  it('rejects an empty account id', () => {
    expect(() => accountScope('')).toThrow(TypeError)
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
    await client.request({ method: 'GET', path: '/accounts', query: { per_page: 5 } })
    expect(requests[0]!.url).toBe('https://api.test/client/v4/accounts?per_page=5')
  })

  it('defaults the base URL when none is configured', async () => {
    const requests: Request[] = []
    const client = new CloudflareClient({
      credentials: { resolve: () => 'tok' },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
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
      json({ success: false, errors: [{ code: 7003, message: 'no route' }], messages: [], result: null }, { status: 400 }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow('[7003] no route')
  })

  it('maps an unauthenticated response to an auth error', async () => {
    const { client } = makeClient(async () =>
      json({ success: false, errors: [{ code: 10000, message: 'bad token' }], messages: [], result: null }, { status: 403 }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })

  it('maps a 404 to a not-found error', async () => {
    const { client } = makeClient(async () =>
      json({ success: false, errors: [], messages: [], result: null }, { status: 404 }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareNotFoundError)
  })

  it('classifies a non-JSON error body by status', async () => {
    const { client } = makeClient(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
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

  it('rejects a 2xx response whose body is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('<html>hi</html>', { status: 200 }))
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
  })

  it('carries the retry hint from a rate-limited JSON envelope', async () => {
    const { client } = makeClient(async () =>
      json({ success: false, errors: [{ code: 971, message: 'slow' }], messages: [], result: null }, {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '7' },
      }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({
      name: 'CloudflareRateLimitError',
      retryAfterMs: 7000,
    })
  })

  it('throws when success is false on a 2xx status', async () => {
    const { client } = makeClient(async () =>
      json({ success: false, errors: [{ code: 1, message: 'soft fail' }], messages: [], result: null }),
    )
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow('[1] soft fail')
  })

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0
    const { client } = makeClient(async () => {
      calls += 1
      return calls === 1 ? json({ success: false, errors: [], messages: [], result: null }, { status: 503 }) : json(ok('done'))
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
      fetch: async () => {
        calls += 1
        return calls === 1 ? json({ success: false, errors: [], messages: [], result: null }, { status: 500 }) : json(ok(1))
      },
      sleep: async () => {},
      random: () => 1,
    })
    await client.request({ method: 'GET', path: '/x' })
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      fetch: async () => json(ok(null)),
    })
    await expect(client.request({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareAuthError)
  })

  it('uses real timers by default without hanging', async () => {
    let calls = 0
    const client = new CloudflareClient({
      credentials: { resolve: () => 'tok' },
      apiTokenRef: REF,
      retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      maxPages: 1,
      fetch: async () => {
        calls += 1
        return calls === 1 ? json({ success: false, errors: [], messages: [], result: null }, { status: 500 }) : json(ok('ok'))
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
      credentials: { resolve: () => values[i++] },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
      fetch: async () => json(ok(null)),
    })
    await expect(client.resolveToken()).resolves.toBe('first')
    await expect(client.resolveToken()).resolves.toBe('second')
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
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
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
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
      json({ success: false, errors: [{ code: 9, message: 'nope' }], messages: [], result: null }, { status: 400 }),
    )
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow('[9] nope')
  })

  it('throws when the body is not an envelope', async () => {
    const { client } = makeClient(async () => new Response('nope', { status: 500 }))
    await expect(client.requestEnvelope({ method: 'GET', path: '/x' })).rejects.toThrow(CloudflareError)
  })

  it('fails loud when the credential is missing', async () => {
    const client = new CloudflareClient({
      credentials: { resolve: () => undefined },
      apiTokenRef: REF,
      retry,
      maxPages: 1,
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
    await expect(client.listAll({ method: 'GET', path: '/x' }, nextCursorQuery)).resolves.toEqual(['a', 'b'])
    expect(requests[1]!.url).toBe('https://api.test/client/v4/x?cursor=c1')
  })

  it('merges the spec query with the page overlay', async () => {
    const pages = [json(ok(['a'], { cursor: 'c1' })), json(ok(['b'], { cursor: '' }))]
    let i = 0
    const { client, requests } = makeClient(async () => pages[i++]!)
    await client.listAll({ method: 'GET', path: '/x', query: { per_page: 2 } }, nextCursorQuery)
    expect(requests[1]!.url).toContain('per_page=2')
    expect(requests[1]!.url).toContain('cursor=c1')
  })

  it('honours the maxPages ceiling', async () => {
    const { client, requests } = makeClient(async () => json(ok(['x'], { cursor: 'always' })), { maxPages: 3 })
    await expect(client.listAll({ method: 'GET', path: '/x' }, nextCursorQuery)).resolves.toEqual(['x', 'x', 'x'])
    expect(requests).toHaveLength(3)
  })

  it('propagates an error mid-walk', async () => {
    const pages = [
      json(ok(['a'], { cursor: 'c1' })),
      json({ success: false, errors: [{ code: 2, message: 'mid' }], messages: [], result: null }, { status: 500 }),
    ]
    let i = 0
    const { client } = makeClient(async () => pages[i++]!)
    await expect(client.listAll({ method: 'GET', path: '/x' }, nextCursorQuery)).rejects.toThrow('[2] mid')
  })
})

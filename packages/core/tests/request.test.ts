import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  assertSafePath,
  buildHeaders,
  buildQueryString,
  buildRequest,
  buildUrl,
  isBodyless,
} from '../src/request.ts'

describe('DEFAULT_BASE_URL', () => {
  it('points at the Cloudflare v4 REST root', () => {
    expect(DEFAULT_BASE_URL).toBe('https://api.cloudflare.com/client/v4')
  })
})

describe('isBodyless', () => {
  it.each(['GET', 'HEAD'] as const)('treats %s as bodyless', (m) => {
    expect(isBodyless(m)).toBe(true)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('allows a body on %s', (m) => {
    expect(isBodyless(m)).toBe(false)
  })
})

describe('buildQueryString', () => {
  it('returns empty for undefined', () => {
    expect(buildQueryString(undefined)).toBe('')
  })

  it('returns empty for an object with no defined values', () => {
    expect(buildQueryString({ a: undefined })).toBe('')
  })

  it('serializes a string value', () => {
    expect(buildQueryString({ name: 'x' })).toBe('?name=x')
  })

  it('serializes numbers and booleans', () => {
    expect(buildQueryString({ n: 3, b: true })).toBe('?n=3&b=true')
  })

  it('repeats the key for array values', () => {
    expect(buildQueryString({ id: ['a', 'b'] })).toBe('?id=a&id=b')
  })

  it('drops only the undefined keys', () => {
    expect(buildQueryString({ a: '1', b: undefined, c: '2' })).toBe('?a=1&c=2')
  })

  it('percent-encodes values', () => {
    expect(buildQueryString({ q: 'a b&c' })).toBe('?q=a+b%26c')
  })

  it('serializes an empty array to nothing', () => {
    expect(buildQueryString({ id: [] })).toBe('')
  })
})

describe('assertSafePath', () => {
  it('returns a safe path unchanged', () => {
    expect(assertSafePath('/accounts/a/d1')).toBe('/accounts/a/d1')
  })

  it('rejects a path without a leading slash', () => {
    expect(() => assertSafePath('accounts')).toThrow(/must start with/)
  })

  it('rejects a protocol-relative path', () => {
    expect(() => assertSafePath('//evil.example.com/x')).toThrow(/protocol-relative/)
  })

  it('rejects traversal', () => {
    expect(() => assertSafePath('/accounts/../../etc')).toThrow(/\.\./)
  })

  it('rejects an absolute URL', () => {
    expect(() => assertSafePath('https://evil.example.com')).toThrow(/must start with/)
  })
})

describe('buildUrl', () => {
  it('joins base and path', () => {
    expect(buildUrl(DEFAULT_BASE_URL, { path: '/accounts' })).toBe(`${DEFAULT_BASE_URL}/accounts`)
  })

  it('strips exactly one trailing slash from the base', () => {
    expect(buildUrl('https://x.test/v4/', { path: '/a' })).toBe('https://x.test/v4/a')
  })

  it('appends the query string', () => {
    expect(buildUrl('https://x.test', { path: '/a', query: { p: 1 } })).toBe('https://x.test/a?p=1')
  })

  it('propagates path validation', () => {
    expect(() => buildUrl('https://x.test', { path: '../a' })).toThrow(TypeError)
  })
})

describe('buildHeaders', () => {
  it('always sets accept', () => {
    expect(buildHeaders({ token: 't', hasBody: false }).get('accept')).toBe('application/json')
  })

  it('sets the bearer token', () => {
    expect(buildHeaders({ token: 'tok', hasBody: false }).get('authorization')).toBe('Bearer tok')
  })

  it('sets content-type only when a body is sent', () => {
    expect(buildHeaders({ token: 't', hasBody: true }).get('content-type')).toBe('application/json')
    expect(buildHeaders({ token: 't', hasBody: false }).get('content-type')).toBeNull()
  })

  it('includes extra headers', () => {
    expect(buildHeaders({ token: 't', hasBody: false, extra: { 'cf-x': '1' } }).get('cf-x')).toBe('1')
  })

  it('never lets an extra header displace the resolved credential', () => {
    const h = buildHeaders({ token: 'real', hasBody: false, extra: { authorization: 'Bearer spoofed' } })
    expect(h.get('authorization')).toBe('Bearer real')
  })

  it('tolerates an undefined extra map', () => {
    expect(buildHeaders({ token: 't', hasBody: false, extra: undefined }).get('accept')).toBe('application/json')
  })
})

describe('buildRequest', () => {
  const base = 'https://api.test/client/v4'

  it('builds a GET with no body', async () => {
    const req = buildRequest({ baseUrl: base, spec: { method: 'GET', path: '/accounts' }, token: 't' })
    expect(req.method).toBe('GET')
    expect(req.url).toBe(`${base}/accounts`)
    expect(req.body).toBeNull()
  })

  it('serializes a JSON body on POST', async () => {
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'POST', path: '/x', body: { a: 1 } },
      token: 't',
    })
    await expect(req.text()).resolves.toBe('{"a":1}')
    expect(req.headers.get('content-type')).toBe('application/json')
  })

  it('drops a body supplied on a bodyless method', async () => {
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'GET', path: '/x', body: { a: 1 } },
      token: 't',
    })
    expect(req.body).toBeNull()
    expect(req.headers.get('content-type')).toBeNull()
  })

  it('omits the body when none is supplied on a writable method', async () => {
    const req = buildRequest({ baseUrl: base, spec: { method: 'DELETE', path: '/x' }, token: 't' })
    expect(req.body).toBeNull()
    expect(req.headers.get('content-type')).toBeNull()
  })

  it('carries the query string through', () => {
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'GET', path: '/x', query: { per_page: 50 } },
      token: 't',
    })
    expect(req.url).toBe(`${base}/x?per_page=50`)
  })

  it('applies spec headers', () => {
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'GET', path: '/x', headers: { 'cf-aig-metadata': '{}' } },
      token: 't',
    })
    expect(req.headers.get('cf-aig-metadata')).toBe('{}')
  })
})

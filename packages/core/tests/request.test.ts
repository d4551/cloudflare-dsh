import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BASE_URL,
  assertSafeBaseUrl,
  assertSafePath,
  buildHeaders,
  buildQueryString,
  buildRequest,
  buildUrl,
  decodePath,
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
    expect(() => assertSafePath('/accounts/../../etc')).toThrow('path must not contain ".."')
  })

  it('names the decoded spelling when only that one breaks the rules', () => {
    // The label is the whole diagnostic value here: `/accounts/%2e%2e/x` looks
    // clean literally, so a message saying only "must not contain .." would
    // send a caller looking at a path that plainly does not contain it.
    expect(() => assertSafePath('/accounts/%2e%2e/x')).toThrow('decoded path must not contain ".."')
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
})

describe('buildRequest', () => {
  const base = 'https://api.test/client/v4'

  it('builds a GET with no body', async () => {
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'GET', path: '/accounts' },
      token: 't',
    })
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
    const req = buildRequest({
      baseUrl: base,
      spec: { method: 'DELETE', path: '/x' },
      token: 't',
    })
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
})

describe('decodePath', () => {
  it('returns a path with no escapes unchanged', () => {
    expect(decodePath('/accounts/x/tokens')).toBe('/accounts/x/tokens')
  })

  it('decodes a single-encoded path', () => {
    expect(decodePath('/accounts/x/%74okens')).toBe('/accounts/x/tokens')
  })

  it('decodes to a fixed point, since a server may decode more than once', () => {
    expect(decodePath('/accounts/x/%2574okens')).toBe('/accounts/x/tokens')
  })

  it('rejects a malformed escape rather than passing it through', () => {
    expect(() => decodePath('/accounts/%zz')).toThrow(
      'path contains a malformed percent-escape: "/accounts/%zz"',
    )
  })

  it('refuses a path encoded deeper than it can validate', () => {
    // Each round strips one layer; beyond the bound the value is refused
    // rather than assumed safe.
    // Each `25` inserted after the `%` costs one decoding round: this needs
    // more rounds than the bound allows, so it is refused rather than assumed
    // safe. Built from parts so the nesting is legible.
    // Exactly one layer past what the bound can resolve, so this also pins the
    // comparison itself: a `<=` here would accept it.
    const nested = `%${'25'.repeat(3)}2E`
    expect(() => decodePath(`/x/${nested}`)).toThrow(
      `path is encoded beyond the depth this can validate: ${JSON.stringify(`/x/${nested}`)}`,
    )
  })

  it('decodes right up to the bound without refusing', () => {
    // One layer fewer than the case above: the deepest value the bound can
    // resolve must still be accepted, or the guard rejects what it can validate.
    expect(decodePath(`/x/%${'25'.repeat(2)}2E`)).toBe('/x/.')
  })
})

describe('assertSafeBaseUrl', () => {
  it('accepts the Cloudflare REST root', () => {
    expect(assertSafeBaseUrl('https://api.cloudflare.com/client/v4')).toBe(
      'https://api.cloudflare.com/client/v4',
    )
  })

  it('rejects a value that is not an absolute URL', () => {
    expect(() => assertSafeBaseUrl('/client/v4')).toThrow('baseUrl must be an absolute URL, got "/client/v4"')
  })

  it('rejects a downgraded scheme, which would send the token in clear text', () => {
    expect(() => assertSafeBaseUrl('http://api.cloudflare.com/client/v4')).toThrow(
      'baseUrl must use https:, got "http:"',
    )
  })

  it.each(['ftp://api.cloudflare.com', 'file:///etc/passwd'])('rejects %s', (url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow(/must use https:/)
  })

  it.each([
    ['a username and password', 'https://user:pw@api.cloudflare.com/client/v4'],
    ['a username alone', 'https://user@api.cloudflare.com/client/v4'],
    ['a password alone', 'https://:pw@api.cloudflare.com/client/v4'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow(/must not embed credentials/)
  })

  it.each([
    ['a query string', 'https://api.cloudflare.com/client/v4?x=1'],
    ['a fragment', 'https://api.cloudflare.com/client/v4#x'],
  ])('rejects %s', (_label, url) => {
    expect(() => assertSafeBaseUrl(url)).toThrow('baseUrl must not carry a query string or fragment')
  })
})

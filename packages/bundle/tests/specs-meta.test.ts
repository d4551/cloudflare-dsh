import { describe, expect, it } from 'vitest'
import { CloudflareApiDeniedError, buildGenericSpec, isReadOnlyMethod } from '../src/specs/meta.ts'

const READ_ONLY = { allowMutations: false, denyPathPrefixes: [] }
const OPEN = { allowMutations: true, denyPathPrefixes: [] }

describe('isReadOnlyMethod', () => {
  it.each(['GET', 'HEAD'] as const)('treats %s as read-only', (m) => {
    expect(isReadOnlyMethod(m)).toBe(true)
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('treats %s as mutating', (m) => {
    expect(isReadOnlyMethod(m)).toBe(false)
  })
})

describe('buildGenericSpec', () => {
  it('builds a read request', () => {
    expect(buildGenericSpec('GET', '/accounts', undefined, undefined, READ_ONLY)).toStrictEqual({
      method: 'GET',
      path: '/accounts',
    })
  })

  it('includes a query when given', () => {
    expect(buildGenericSpec('GET', '/accounts', { per_page: '5' }, undefined, READ_ONLY).query).toStrictEqual(
      {
        per_page: '5',
      },
    )
  })

  it('includes a body when given and mutations are allowed', () => {
    expect(buildGenericSpec('POST', '/x', undefined, { a: 1 }, OPEN).body).toStrictEqual({ a: 1 })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('refuses %s while read-only', (method) => {
    expect(() => buildGenericSpec(method, '/x', undefined, undefined, READ_ONLY)).toThrow(
      CloudflareApiDeniedError,
    )
  })

  it('names the denial error so it is identifiable in a session log', () => {
    expect(() => buildGenericSpec('POST', '/x', undefined, undefined, READ_ONLY)).toThrow(
      expect.objectContaining({ name: 'CloudflareApiDeniedError' }),
    )
  })

  describe('the denylist sees what the server sees', () => {
    const DENIED = {
      allowMutations: false,
      denyPathPrefixes: ['/accounts/x/tokens'],
    }

    it('blocks the literal path', () => {
      expect(() => buildGenericSpec('GET', '/accounts/x/tokens', undefined, undefined, DENIED)).toThrow(
        CloudflareApiDeniedError,
      )
    })

    it.each([
      ['single-encoded', '/accounts/x/%74okens'],
      ['double-encoded', '/accounts/x/%2574okens'],
      ['mixed case escape', '/accounts/x/%74oken%73'],
    ])('blocks a %s spelling of the same resource', (_label, path) => {
      // The server percent-decodes before it routes, so these all reach
      // `/accounts/x/tokens`. Comparing the raw text alone let them through.
      expect(() => buildGenericSpec('GET', path, undefined, undefined, DENIED)).toThrow(
        CloudflareApiDeniedError,
      )
    })

    it('blocks a path that merely starts with the prefix', () => {
      // `startsWith`, not `endsWith`: a denied prefix covers everything beneath
      // it, so the child resource must be blocked too.
      expect(() =>
        buildGenericSpec('GET', '/accounts/x/tokens/abc123', undefined, undefined, DENIED),
      ).toThrow(CloudflareApiDeniedError)
    })

    it('names the offending prefix so the denial is explicable', () => {
      expect(() => buildGenericSpec('GET', '/accounts/x/tokens', undefined, undefined, DENIED)).toThrow(
        'path /accounts/x/tokens is blocked by the configured denylist (/accounts/x/tokens)',
      )
    })

    it('still allows a path the denylist does not name', () => {
      expect(buildGenericSpec('GET', '/accounts/x/members', undefined, undefined, DENIED).path).toBe(
        '/accounts/x/members',
      )
    })

    it('allows a legitimately encoded segment that is not denied', () => {
      // `seg()` percent-encodes every id, so encoding itself must stay legal.
      expect(buildGenericSpec('GET', '/accounts/a%2Fb/members', undefined, undefined, DENIED).path).toBe(
        '/accounts/a%2Fb/members',
      )
    })
  })

  it('rejects an encoded traversal, which decodes to a real one', () => {
    expect(() => buildGenericSpec('GET', '/a/%2e%2e/%2e%2e/x', undefined, undefined, READ_ONLY)).toThrow(
      TypeError,
    )
  })

  it('explains how to permit mutations', () => {
    expect(() => buildGenericSpec('POST', '/x', undefined, undefined, READ_ONLY)).toThrow(
      'POST is a mutating request and this plugin is configured read-only. Set `allowMutations: true` on the cloudflare-tools-meta plugin to permit it.',
    )
  })

  it('permits mutations once configured', () => {
    expect(buildGenericSpec('DELETE', '/x', undefined, undefined, OPEN).method).toBe('DELETE')
  })

  it('refuses a denylisted prefix even for reads', () => {
    expect(() =>
      buildGenericSpec('GET', '/accounts/a/secrets_store/stores', undefined, undefined, {
        allowMutations: true,
        denyPathPrefixes: ['/accounts/a/secrets_store'],
      }),
    ).toThrow(CloudflareApiDeniedError)
  })

  it('names the matching denylist prefix', () => {
    expect(() =>
      buildGenericSpec('GET', '/user/tokens', undefined, undefined, {
        allowMutations: false,
        denyPathPrefixes: ['/user'],
      }),
    ).toThrow('path /user/tokens is blocked by the configured denylist (/user)')
  })

  it('allows a path that does not match any denylist prefix', () => {
    expect(
      buildGenericSpec('GET', '/zones', undefined, undefined, {
        allowMutations: false,
        denyPathPrefixes: ['/user'],
      }).path,
    ).toBe('/zones')
  })

  it('checks every configured prefix, not just the first', () => {
    expect(() =>
      buildGenericSpec('GET', '/user/tokens', undefined, undefined, {
        allowMutations: false,
        denyPathPrefixes: ['/zones', '/user'],
      }),
    ).toThrow(CloudflareApiDeniedError)
  })

  it('cannot be pointed at another host', () => {
    expect(() => buildGenericSpec('GET', 'https://evil.test/x', undefined, undefined, READ_ONLY)).toThrow(
      TypeError,
    )
  })

  it('cannot be pointed at a protocol-relative URL', () => {
    expect(() => buildGenericSpec('GET', '//evil.test/x', undefined, undefined, READ_ONLY)).toThrow(TypeError)
  })

  it('cannot traverse out of the api root', () => {
    expect(() => buildGenericSpec('GET', '/accounts/../../x', undefined, undefined, READ_ONLY)).toThrow(
      TypeError,
    )
  })
})

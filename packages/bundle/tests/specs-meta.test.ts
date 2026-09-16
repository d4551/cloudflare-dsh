import { describe, expect, it } from 'vitest'
import { CloudflareApiDeniedError, buildGenericSpec } from '../src/specs/meta.ts'

const NONE = { denyPathPrefixes: [] }

/** Both spellings `safeApiPath` hands the builder: the contained path and its decoded form. */
function pair(safe: string, decoded: string = safe): { readonly safe: string; readonly decoded: string } {
  return { safe, decoded }
}

describe('buildGenericSpec', () => {
  it('builds a read request', () => {
    expect(buildGenericSpec('GET', pair('/accounts'), undefined, undefined, NONE)).toStrictEqual({
      method: 'GET',
      path: '/accounts',
    })
  })

  it('includes a query when given', () => {
    expect(
      buildGenericSpec('GET', pair('/accounts'), { per_page: '5' }, undefined, NONE).query,
    ).toStrictEqual({
      per_page: '5',
    })
  })

  it('includes a body when given', () => {
    expect(buildGenericSpec('POST', pair('/x'), undefined, { a: 1 }, NONE).body).toStrictEqual({ a: 1 })
  })

  it('names the denial error so it is identifiable in a session log', () => {
    expect(() =>
      buildGenericSpec('GET', pair('/user/tokens'), undefined, undefined, { denyPathPrefixes: ['/user'] }),
    ).toThrow(expect.objectContaining({ name: 'CloudflareApiDeniedError' }))
  })

  describe('the denylist sees what the server sees', () => {
    const DENIED = {
      denyPathPrefixes: ['/accounts/x/tokens'],
    }

    it('blocks the literal path', () => {
      expect(() => buildGenericSpec('GET', pair('/accounts/x/tokens'), undefined, undefined, DENIED)).toThrow(
        CloudflareApiDeniedError,
      )
    })

    it.each([
      ['a decoded spelling of the same resource', pair('/accounts/x/%74okens', '/accounts/x/tokens')],
      ['a twice-decoded spelling of the same resource', pair('/accounts/x/%2574okens', '/accounts/x/tokens')],
      ['a mixed-case escape', pair('/accounts/x/%74oken%73', '/accounts/x/tokens')],
    ])('blocks %s', (_label, paths) => {
      // The server percent-decodes to a fixed point before it routes, so the
      // fully-decoded spelling has to reach the denylist next to the literal
      // one — `safeApiPath` produces exactly that pair.
      expect(() => buildGenericSpec('GET', paths, undefined, undefined, DENIED)).toThrow(
        CloudflareApiDeniedError,
      )
    })

    it('blocks a path that merely starts with the prefix', () => {
      // `startsWith`, not `endsWith`: a denied prefix covers everything beneath
      // it, so the child resource must be blocked too.
      expect(() =>
        buildGenericSpec('GET', pair('/accounts/x/tokens/abc123'), undefined, undefined, DENIED),
      ).toThrow(CloudflareApiDeniedError)
    })

    it('names the offending prefix so the denial is explicable', () => {
      expect(() => buildGenericSpec('GET', pair('/accounts/x/tokens'), undefined, undefined, DENIED)).toThrow(
        'path /accounts/x/tokens is blocked by the configured denylist (/accounts/x/tokens)',
      )
    })

    it('still allows a path the denylist does not name', () => {
      expect(buildGenericSpec('GET', pair('/accounts/x/members'), undefined, undefined, DENIED).path).toBe(
        '/accounts/x/members',
      )
    })

    it('allows a legitimately encoded segment that is not denied', () => {
      // `seg()` percent-encodes every id, so encoding itself must stay legal.
      const paths = pair('/accounts/a%2Fb/members', '/accounts/a/b/members')
      expect(buildGenericSpec('GET', paths, undefined, undefined, DENIED).path).toBe(
        '/accounts/a%2Fb/members',
      )
    })
  })

  it('builds a mutating request', () => {
    expect(buildGenericSpec('DELETE', pair('/x'), undefined, undefined, NONE).method).toBe('DELETE')
  })

  it('refuses a denylisted prefix even for reads', () => {
    expect(() =>
      buildGenericSpec('GET', pair('/accounts/a/secrets_store/stores'), undefined, undefined, {
        denyPathPrefixes: ['/accounts/a/secrets_store'],
      }),
    ).toThrow(CloudflareApiDeniedError)
  })

  it('names the matching denylist prefix', () => {
    expect(() =>
      buildGenericSpec('GET', pair('/user/tokens'), undefined, undefined, {
        denyPathPrefixes: ['/user'],
      }),
    ).toThrow('path /user/tokens is blocked by the configured denylist (/user)')
  })

  it('allows a path that does not match any denylist prefix', () => {
    expect(
      buildGenericSpec('GET', pair('/zones'), undefined, undefined, {
        denyPathPrefixes: ['/user'],
      }).path,
    ).toBe('/zones')
  })

  it('checks every configured prefix, not just the first', () => {
    expect(() =>
      buildGenericSpec('GET', pair('/user/tokens'), undefined, undefined, {
        denyPathPrefixes: ['/zones', '/user'],
      }),
    ).toThrow(CloudflareApiDeniedError)
  })
})

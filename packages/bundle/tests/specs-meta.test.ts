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
    expect(buildGenericSpec('GET', '/accounts', { per_page: '5' }, undefined, READ_ONLY).query).toStrictEqual({
      per_page: '5',
    })
  })

  it('includes a body when given and mutations are allowed', () => {
    expect(buildGenericSpec('POST', '/x', undefined, { a: 1 }, OPEN).body).toStrictEqual({ a: 1 })
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('refuses %s while read-only', (method) => {
    expect(() => buildGenericSpec(method, '/x', undefined, undefined, READ_ONLY)).toThrow(CloudflareApiDeniedError)
  })

  it('names the denial error so it is identifiable in a session log', () => {
    expect(() => buildGenericSpec('POST', '/x', undefined, undefined, READ_ONLY)).toThrow(
      expect.objectContaining({ name: 'CloudflareApiDeniedError' }),
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
    expect(() => buildGenericSpec('GET', 'https://evil.test/x', undefined, undefined, READ_ONLY)).toThrow(TypeError)
  })

  it('cannot be pointed at a protocol-relative URL', () => {
    expect(() => buildGenericSpec('GET', '//evil.test/x', undefined, undefined, READ_ONLY)).toThrow(TypeError)
  })

  it('cannot traverse out of the api root', () => {
    expect(() => buildGenericSpec('GET', '/accounts/../../x', undefined, undefined, READ_ONLY)).toThrow(TypeError)
  })
})

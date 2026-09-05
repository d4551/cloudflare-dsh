import { describe, expect, it } from 'vitest'
import { makeScope, scopeSegment, scopedPath } from '../src/scope.ts'

describe('scopeSegment', () => {
  it('maps account to the accounts segment', () => {
    expect(scopeSegment('account')).toBe('accounts')
  })

  it('maps zone to the zones segment', () => {
    expect(scopeSegment('zone')).toBe('zones')
  })
})

describe('makeScope', () => {
  it('builds an account scope', () => {
    expect(makeScope('account', 'acc1')).toEqual({ kind: 'account', id: 'acc1' })
  })

  it('builds a zone scope', () => {
    expect(makeScope('zone', 'z1')).toEqual({ kind: 'zone', id: 'z1' })
  })

  it('rejects an empty id so misconfiguration fails loud', () => {
    expect(() => makeScope('account', '')).toThrow(TypeError)
    expect(() => makeScope('zone', '')).toThrow(/zone id must not be empty/)
  })
})

describe('scopedPath', () => {
  it('prefixes an account-scoped path', () => {
    expect(scopedPath({ kind: 'account', id: 'a1' }, '/d1/database')).toBe('/accounts/a1/d1/database')
  })

  it('prefixes a zone-scoped path', () => {
    expect(scopedPath({ kind: 'zone', id: 'z1' }, '/dns_records')).toBe('/zones/z1/dns_records')
  })

  it('percent-encodes the identifier', () => {
    expect(scopedPath({ kind: 'account', id: 'a/b' }, '/x')).toBe('/accounts/a%2Fb/x')
  })

  it('rejects a relative path without a leading slash', () => {
    expect(() => scopedPath({ kind: 'account', id: 'a' }, 'd1')).toThrow(TypeError)
  })

  it('names the offending path in the error so the misconfiguration is findable', () => {
    expect(() => scopedPath({ kind: 'account', id: 'a' }, 'd1')).toThrow(
      'scope-relative path must start with "/", got "d1"',
    )
  })
})

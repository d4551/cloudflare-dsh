import { describe, expect, it } from 'vitest'
import { makeScope, scopedPath } from '../src/scope.ts'

describe('makeScope', () => {
  it('builds the account scope', () => {
    expect(makeScope('acc1')).toEqual({ id: 'acc1' })
  })

  it('rejects an empty id so misconfiguration fails loud', () => {
    expect(() => makeScope('')).toThrow(TypeError)
    expect(() => makeScope('')).toThrow('Cloudflare account id must not be empty')
  })
})

describe('scopedPath', () => {
  it('prefixes an account-scoped path', () => {
    expect(scopedPath({ id: 'a1' }, '/d1/database')).toBe('/accounts/a1/d1/database')
  })

  it('percent-encodes the identifier', () => {
    expect(scopedPath({ id: 'a/b' }, '/x')).toBe('/accounts/a%2Fb/x')
  })

  it('rejects a relative path without a leading slash', () => {
    expect(() => scopedPath({ id: 'a' }, 'd1')).toThrow(TypeError)
  })

  it('names the offending path in the error so the misconfiguration is findable', () => {
    expect(() => scopedPath({ id: 'a' }, 'd1')).toThrow('scope-relative path must start with "/", got "d1"')
  })
})

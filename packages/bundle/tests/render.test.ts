import { describe, expect, it } from 'vitest'
import { json, listing, plural, text, truncate } from '../src/tools/_shared/render.ts'

describe('text', () => {
  it('wraps a string as one text block', () => {
    expect(text('hi')).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('preserves an empty string', () => {
    expect(text('')).toEqual([{ type: 'text', text: '' }])
  })
})

describe('json', () => {
  it('pretty-prints with two-space indentation', () => {
    expect(json({ a: 1 })).toEqual([{ type: 'text', text: '{\n  "a": 1\n}' }])
  })
})

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'key')).toBe('1 key')
  })

  it('uses the plural for zero', () => {
    expect(plural(0, 'key')).toBe('0 keys')
  })

  it('uses the plural for many', () => {
    expect(plural(3, 'key')).toBe('3 keys')
  })

})

describe('listing', () => {
  it('leads with a count line then the payload', () => {
    expect(listing(2, 'bucket', ['a', 'b'])).toEqual([
      { type: 'text', text: '2 buckets\n[\n  "a",\n  "b"\n]' },
    ])
  })

  it('uses the singular for one item', () => {
    expect(listing(1, 'bucket', ['a'])).toEqual([{ type: 'text', text: '1 bucket\n[\n  "a"\n]' }])
  })
})

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('abc', 10)).toBe('abc')
  })

  it('returns text at exactly the limit unchanged', () => {
    expect(truncate('abcde', 5)).toBe('abcde')
  })

  it('cuts longer text and says how much was dropped', () => {
    expect(truncate('abcdefgh', 5)).toBe('abcde\n… truncated 3 characters')
  })

  it('uses the singular when exactly one character is dropped', () => {
    expect(truncate('abcdef', 5)).toBe('abcde\n… truncated 1 character')
  })
})

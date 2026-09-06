import { describe, expect, it } from 'vitest'
import { formatCacheRate, formatCost, hasUsage, isValidCredentialRef } from '../src/format.ts'

describe('formatCost', () => {
  it('formats zero as an exact amount, not a dash', () => {
    expect(formatCost(0)).toBe('$0.00')
  })

  it('formats ordinary amounts to two places', () => {
    expect(formatCost(1.239)).toBe('$1.24')
  })

  it('keeps precision on sub-cent amounts so they do not read as free', () => {
    expect(formatCost(0.00042)).toBe('$0.00042')
  })

  it('formats a value just under a cent with more precision', () => {
    expect(formatCost(0.009)).toBe('$0.00900')
  })

  it('formats a value at exactly one cent to two places', () => {
    expect(formatCost(0.01)).toBe('$0.01')
  })

  it('handles a negative adjustment', () => {
    expect(formatCost(-1.5)).toBe('$-1.50')
  })

  it('returns a dash for a non-finite amount', () => {
    expect(formatCost(Number.NaN)).toBe('—')
    expect(formatCost(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('formatCacheRate', () => {
  it('returns a dash when there were no requests', () => {
    expect(formatCacheRate({ requests: 0, cached: 0 })).toBe('—')
  })

  it('returns a dash for a negative request count', () => {
    expect(formatCacheRate({ requests: -1, cached: 0 })).toBe('—')
  })

  it('reports zero percent when nothing was cached', () => {
    expect(formatCacheRate({ requests: 4, cached: 0 })).toBe('0%')
  })

  it('reports a partial rate', () => {
    expect(formatCacheRate({ requests: 4, cached: 1 })).toBe('25%')
  })

  it('reports a full rate', () => {
    expect(formatCacheRate({ requests: 3, cached: 3 })).toBe('100%')
  })

  it('rounds to the nearest whole percent', () => {
    expect(formatCacheRate({ requests: 3, cached: 1 })).toBe('33%')
  })
})

describe('hasUsage', () => {
  const usage = { requests: 1, cost: 0, tokensIn: 0, tokensOut: 0, cached: 0 }

  it('is false for undefined', () => {
    expect(hasUsage(undefined)).toBe(false)
  })

  it('is false when no requests were made', () => {
    expect(hasUsage({ ...usage, requests: 0 })).toBe(false)
  })

  it('is true once there is at least one request', () => {
    expect(hasUsage(usage)).toBe(true)
  })
})

describe('isValidCredentialRef', () => {
  it.each(['CLOUDFLARE_API_TOKEN', 'CF', 'A1_B2'])('accepts %s', (value) => {
    expect(isValidCredentialRef(value)).toBe(true)
  })

  it.each(['', 'lowercase', '1LEADING_DIGIT', '_LEADING_UNDERSCORE', 'HAS SPACE', 'HAS-DASH'])(
    'rejects %s',
    (value) => {
      expect(isValidCredentialRef(value)).toBe(false)
    },
  )
})

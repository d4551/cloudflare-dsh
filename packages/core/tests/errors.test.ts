import { describe, expect, it } from 'vitest'
import {
  CF_CODE_UNAUTHORIZED,
  CloudflareAuthError,
  CloudflareError,
  CloudflareNotFoundError,
  CloudflareRateLimitError,
  classifyFailure,
  formatErrorEntries,
  isRetryableStatus,
  parseRetryAfterMs,
} from '../src/errors.ts'

const REF = 'CLOUDFLARE_API_TOKEN'

describe('formatErrorEntries', () => {
  it('reports a placeholder when there are no entries', () => {
    expect(formatErrorEntries([])).toBe('Cloudflare request failed with no error detail')
  })

  it('formats a single entry as code and message', () => {
    expect(formatErrorEntries([{ code: 7003, message: 'Could not route' }])).toBe('[7003] Could not route')
  })

  it('joins multiple entries with a semicolon', () => {
    expect(formatErrorEntries([
      { code: 1, message: 'a' },
      { code: 2, message: 'b' },
    ])).toBe('[1] a; [2] b')
  })
})

describe('isRetryableStatus', () => {
  it.each([429, 500, 502, 503, 599])('retries %i', (status) => {
    expect(isRetryableStatus(status)).toBe(true)
  })

  it.each([200, 201, 400, 401, 403, 404, 409, 422, 428, 430, 499, 600])('does not retry %i', (status) => {
    expect(isRetryableStatus(status)).toBe(false)
  })
})

describe('parseRetryAfterMs', () => {
  it('returns null for null and undefined', () => {
    expect(parseRetryAfterMs(null)).toBeNull()
    expect(parseRetryAfterMs(undefined)).toBeNull()
  })

  it('returns null for empty and whitespace-only input', () => {
    expect(parseRetryAfterMs('')).toBeNull()
    expect(parseRetryAfterMs('   ')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseRetryAfterMs('soon')).toBeNull()
  })

  it('returns null for a negative delay', () => {
    expect(parseRetryAfterMs('-1')).toBeNull()
  })

  it('converts delta-seconds to milliseconds', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000)
  })

  it('accepts zero', () => {
    expect(parseRetryAfterMs('0')).toBe(0)
  })

  it('rounds fractional seconds', () => {
    expect(parseRetryAfterMs('1.2345')).toBe(1235)
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRetryAfterMs(' 5 ')).toBe(5000)
  })
})

describe('classifyFailure', () => {
  it('maps the unauthorized code to an auth error regardless of status', () => {
    const err = classifyFailure({
      status: 200,
      credentialRef: REF,
      envelope: { errors: [{ code: CF_CODE_UNAUTHORIZED, message: 'bad token' }] },
    })
    expect(err).toBeInstanceOf(CloudflareAuthError)
    expect((err as CloudflareAuthError).credentialRef).toBe(REF)
    expect(err.message).toBe('[10000] bad token')
  })

  it.each([401, 403])('maps status %i to an auth error', (status) => {
    expect(classifyFailure({ status, credentialRef: REF })).toBeInstanceOf(CloudflareAuthError)
  })

  it('maps 429 to a rate limit error and carries the retry hint', () => {
    const err = classifyFailure({ status: 429, credentialRef: REF, retryAfter: '12' })
    expect(err).toBeInstanceOf(CloudflareRateLimitError)
    expect((err as CloudflareRateLimitError).retryAfterMs).toBe(12_000)
    expect(err.status).toBe(429)
  })

  it('leaves the retry hint null when the header is absent', () => {
    const err = classifyFailure({ status: 429, credentialRef: REF })
    expect((err as CloudflareRateLimitError).retryAfterMs).toBeNull()
  })

  it('maps 404 to a not-found error', () => {
    const err = classifyFailure({ status: 404, credentialRef: REF })
    expect(err).toBeInstanceOf(CloudflareNotFoundError)
    expect(err.status).toBe(404)
  })

  it('falls back to the base error for anything else', () => {
    const err = classifyFailure({ status: 500, credentialRef: REF })
    expect(err.constructor).toBe(CloudflareError)
    expect(err.status).toBe(500)
    expect(err.name).toBe('CloudflareError')
  })

  it('preserves codes on the fallback path', () => {
    const err = classifyFailure({
      status: 400,
      credentialRef: REF,
      envelope: { errors: [{ code: 1004, message: 'bad request' }] },
    })
    expect(err.codes).toEqual([1004])
  })

  it('defaults codes to an empty list when no envelope is supplied', () => {
    expect(classifyFailure({ status: 500, credentialRef: REF }).codes).toEqual([])
  })
})

describe('error identity', () => {
  it('names each subclass for log readability', () => {
    expect(new CloudflareError('m', 500).name).toBe('CloudflareError')
    expect(new CloudflareAuthError(REF, 'm', 401).name).toBe('CloudflareAuthError')
    expect(new CloudflareRateLimitError('m', null).name).toBe('CloudflareRateLimitError')
    expect(new CloudflareNotFoundError('m').name).toBe('CloudflareNotFoundError')
  })

  it('defaults codes to empty for directly constructed errors', () => {
    expect(new CloudflareError('m', 500).codes).toEqual([])
    expect(new CloudflareAuthError(REF, 'm', 401).codes).toEqual([])
    expect(new CloudflareRateLimitError('m', null).codes).toEqual([])
    expect(new CloudflareNotFoundError('m').codes).toEqual([])
  })
})

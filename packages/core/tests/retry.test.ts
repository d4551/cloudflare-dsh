import { describe, expect, it, vi } from 'vitest'
import { CloudflareError, CloudflareRateLimitError } from '../src/errors.ts'
import {
  type RetryPolicy,
  backoffDelayMs,
  nextDelayMs,
  runWithRetry,
  shouldRetry,
} from '../src/retry.ts'

const policy: RetryPolicy = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 }
const statusOf = (e: unknown) => (e instanceof CloudflareError ? e.status : 0)

describe('shouldRetry', () => {
  it('retries a 500 while attempts remain', () => {
    expect(shouldRetry(500, 0, policy)).toBe(true)
    expect(shouldRetry(500, 2, policy)).toBe(true)
  })

  it('stops once the budget is spent', () => {
    expect(shouldRetry(500, 3, policy)).toBe(false)
    expect(shouldRetry(500, 4, policy)).toBe(false)
  })

  it('never retries a non-retryable status', () => {
    expect(shouldRetry(400, 0, policy)).toBe(false)
    expect(shouldRetry(404, 0, policy)).toBe(false)
  })

  it('retries a 429', () => {
    expect(shouldRetry(429, 0, policy)).toBe(true)
  })

  it('honours a zero-retry budget', () => {
    expect(shouldRetry(500, 0, { ...policy, maxRetries: 0 })).toBe(false)
  })
})

describe('backoffDelayMs', () => {
  it('grows exponentially with full jitter at the ceiling', () => {
    expect(backoffDelayMs(0, policy, 1)).toBe(100)
    expect(backoffDelayMs(1, policy, 1)).toBe(200)
    expect(backoffDelayMs(2, policy, 1)).toBe(400)
  })

  it('scales by the jitter factor', () => {
    expect(backoffDelayMs(1, policy, 0.5)).toBe(100)
  })

  it('collapses to zero with zero jitter', () => {
    expect(backoffDelayMs(3, policy, 0)).toBe(0)
  })

  it('caps at maxDelayMs before jitter', () => {
    expect(backoffDelayMs(20, policy, 1)).toBe(5000)
  })

  it('rounds to whole milliseconds', () => {
    expect(backoffDelayMs(0, policy, 0.3333)).toBe(33)
  })
})

describe('nextDelayMs', () => {
  it('prefers a server retry hint over computed backoff', () => {
    const err = new CloudflareRateLimitError('slow down', 2000)
    expect(nextDelayMs(err, 0, policy, 1)).toBe(2000)
  })

  it('caps the server hint at maxDelayMs', () => {
    const err = new CloudflareRateLimitError('slow down', 999_999)
    expect(nextDelayMs(err, 0, policy, 1)).toBe(5000)
  })

  it('falls back to backoff when the hint is absent', () => {
    const err = new CloudflareRateLimitError('slow down', null)
    expect(nextDelayMs(err, 1, policy, 1)).toBe(200)
  })

  it('falls back to backoff for a non-rate-limit error', () => {
    expect(nextDelayMs(new CloudflareError('boom', 500), 0, policy, 1)).toBe(100)
  })

  it('falls back to backoff for a non-error value', () => {
    expect(nextDelayMs('nope', 0, policy, 1)).toBe(100)
  })
})

describe('runWithRetry', () => {
  const deps = { sleep: async () => {}, random: () => 1 }

  it('returns the first successful result without sleeping', async () => {
    const sleep = vi.fn(async () => {})
    const attempt = vi.fn(async () => 'ok')
    await expect(runWithRetry(attempt, statusOf, policy, { ...deps, sleep })).resolves.toBe('ok')
    expect(attempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a retryable failure then succeeds', async () => {
    let calls = 0
    const attempt = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new CloudflareError('boom', 503)
      return 'recovered'
    })
    await expect(runWithRetry(attempt, statusOf, policy, deps)).resolves.toBe('recovered')
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it('passes the attempt index to the body', async () => {
    const seen: number[] = []
    const attempt = async (i: number) => {
      seen.push(i)
      if (i < 2) throw new CloudflareError('boom', 500)
      return i
    }
    await expect(runWithRetry(attempt, statusOf, policy, deps)).resolves.toBe(2)
    expect(seen).toEqual([0, 1, 2])
  })

  it('rethrows a non-retryable failure immediately', async () => {
    const attempt = vi.fn(async () => {
      throw new CloudflareError('bad', 400)
    })
    await expect(runWithRetry(attempt, statusOf, policy, deps)).rejects.toThrow('bad')
    expect(attempt).toHaveBeenCalledTimes(1)
  })

  it('gives up after exhausting the budget', async () => {
    const attempt = vi.fn(async () => {
      throw new CloudflareError('always', 500)
    })
    await expect(runWithRetry(attempt, statusOf, policy, deps)).rejects.toThrow('always')
    expect(attempt).toHaveBeenCalledTimes(policy.maxRetries + 1)
  })

  it('waits between attempts using the computed delay', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const attempt = async () => {
      calls += 1
      if (calls === 1) throw new CloudflareRateLimitError('slow', 1500)
      return 'done'
    }
    await runWithRetry(attempt, statusOf, policy, { ...deps, sleep })
    expect(sleep).toHaveBeenCalledWith(1500)
  })
})

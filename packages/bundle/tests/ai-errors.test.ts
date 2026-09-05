import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  PROVIDER_ERROR_CODE,
  RATE_LIMIT_CODE,
  TIMEOUT_CODE,
  UNSUPPORTED_OPTION_CODE,
  classifyProviderCode,
  emptyResponse,
  idleTimeout,
  joinDetail,
  providerError,
  unsupportedOption,
} from '../src/ai/errors.ts'

describe('joinDetail', () => {
  it('joins the defined parts with spaces', () => {
    expect(joinDetail(['a', 'b'])).toBe('a b')
  })

  it('drops undefined parts', () => {
    expect(joinDetail(['a', undefined, 'b'])).toBe('a b')
  })

  it('drops empty parts', () => {
    expect(joinDetail(['a', '', 'b'])).toBe('a b')
  })

  it('returns an empty string when nothing survives', () => {
    expect(joinDetail([undefined, ''])).toBe('')
  })
})

describe('classifyProviderCode', () => {
  it('recognises context overflow ahead of the status class', () => {
    expect(
      classifyProviderCode({ status: 400, detail: "This model's maximum context length is 8192 tokens" }),
    ).toBe(CONTEXT_WINDOW_EXCEEDED_CODE)
  })

  it('recognises an exhausted quota', () => {
    expect(classifyProviderCode({ status: 400, detail: 'insufficient_quota: you exceeded your current quota' })).toBe(
      QUOTA_EXCEEDED_CODE,
    )
  })

  it('classifies a 429 as a rate limit', () => {
    expect(classifyProviderCode({ status: 429, detail: 'too many requests' })).toBe(RATE_LIMIT_CODE)
  })

  it('falls back to a generic provider error', () => {
    expect(classifyProviderCode({ status: 500, detail: 'internal' })).toBe(PROVIDER_ERROR_CODE)
  })

  it('falls back for a 400 with no recognisable wording', () => {
    expect(classifyProviderCode({ status: 400, detail: 'bad request' })).toBe(PROVIDER_ERROR_CODE)
  })
})

describe('providerError', () => {
  it('carries the classified code, message and status', () => {
    const err = providerError({ status: 429, detail: 'slow down' })
    expect(err.code).toBe(RATE_LIMIT_CODE)
    expect(err.message).toBe('slow down')
  })

  it('carries the HTTP status so retry policy can route on it', () => {
    expect(providerError({ status: 503, detail: 'unavailable' })).toMatchObject({
      failure: { status: 503, code: PROVIDER_ERROR_CODE, message: 'unavailable' },
    })
  })

  it('classifies context overflow through the same path', () => {
    expect(providerError({ status: 400, detail: 'maximum context length is 100 tokens' }).code).toBe(
      CONTEXT_WINDOW_EXCEEDED_CODE,
    )
  })
})

describe('unsupportedOption', () => {
  it('names the field and the provider', () => {
    const err = unsupportedOption('reasoningEffort', 'cloudflare-workers-ai')
    expect(err.code).toBe(UNSUPPORTED_OPTION_CODE)
    expect(err.message).toBe(
      'cloudflare-workers-ai does not support the reasoningEffort option; the harness requires adapters to reject it rather than drop it silently.',
    )
  })
})

describe('idleTimeout', () => {
  it('reports the budget that was exceeded', () => {
    const err = idleTimeout(1000)
    expect(err.code).toBe(TIMEOUT_CODE)
    expect(err.message).toBe('provider stream produced no data for 1000ms')
  })
})

describe('emptyResponse', () => {
  it('uses the canonical empty-response code', () => {
    const err = emptyResponse()
    expect(err.code).toBe(EMPTY_RESPONSE_CODE)
    expect(err.message).toBe('provider returned a completion with no content blocks')
  })
})

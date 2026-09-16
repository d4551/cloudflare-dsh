/**
 * The two pure wire-to-harness value mappings the transducer exports: the
 * finish reason, and the token accounting.
 *
 * The state machine that emits chunks is held by `ai-transducer.test.ts`; these
 * two functions are total functions of one payload, so they are exercised
 * exhaustively here without a stream around them.
 */
import { describe, expect, it } from 'vitest'
import { mapFinishReason, mapUsage } from '../src/ai/transducer.ts'

describe('mapFinishReason', () => {
  it('maps tool_calls', () => {
    expect(mapFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
  })

  it('maps length to max-tokens', () => {
    expect(mapFinishReason('length')).toEqual({ kind: 'max-tokens' })
  })

  it('maps stop', () => {
    expect(mapFinishReason('stop')).toEqual({ kind: 'stop' })
  })

  it('maps a content filter to an error finish that names the policy', () => {
    expect(mapFinishReason('content_filter')).toEqual({
      kind: 'error',
      failure: {
        message: 'the provider withheld the completion under its content policy',
        code: 'CONTENT_FILTER',
      },
    })
  })

  it('maps an unknown reason to an error finish that quotes it', () => {
    expect(mapFinishReason('eos_token')).toEqual({
      kind: 'error',
      failure: {
        message: 'the provider ended the completion with an unrecognised finish reason: eos_token',
        code: 'PROVIDER_ERROR',
      },
    })
  })
})

describe('mapUsage', () => {
  it('reports zeros for an empty usage object', () => {
    expect(mapUsage({})).toStrictEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('maps prompt and completion tokens', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 4 })).toStrictEqual({
      inputTokens: 10,
      outputTokens: 4,
    })
  })

  it('subtracts cached tokens so the counts stay disjoint', () => {
    expect(
      mapUsage({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 4 } }),
    ).toStrictEqual({ inputTokens: 6, outputTokens: 1, cacheReadTokens: 4 })
  })

  it('never reports negative input when a provider over-reports cache hits', () => {
    expect(mapUsage({ prompt_tokens: 2, prompt_tokens_details: { cached_tokens: 9 } }).inputTokens).toBe(0)
  })

  it('omits cacheReadTokens when nothing was cached', () => {
    expect(mapUsage({ prompt_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } })).toStrictEqual({
      inputTokens: 3,
      outputTokens: 0,
    })
  })

  it('preserves a provider total when given', () => {
    expect(mapUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }).totalTokens).toBe(3)
  })

  it('omits the total when the provider did not report one', () => {
    expect(mapUsage({ prompt_tokens: 1 }).totalTokens).toBeUndefined()
  })

  it('carries reasoning tokens when reported', () => {
    expect(mapUsage({ completion_tokens_details: { reasoning_tokens: 7 } }).reasoningTokens).toBe(7)
  })

  it('omits reasoning tokens when not reported', () => {
    expect(mapUsage({}).reasoningTokens).toBeUndefined()
  })
})

/**
 * The contract the harness runtime relies on when it registers and drives the
 * Cloudflare model provider.
 *
 * The behavioural suites (`ai-provider`, `ai-provider-stream`, `ai-plugin`)
 * assert what the provider does; this suite asserts the registered shape
 * itself: that the class really extends the runtime base `LlmAdapter`, and
 * that the error-detail reader the package publishes tolerates every body
 * shape a failed provider response can arrive in — including the two
 * composite shapes the single-shape cases do not cover.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { CloudflareAiProvider, readErrorDetail } from '../src/ai/provider.ts'

describe('registered base', () => {
  it('extends LlmAdapter, the base the harness runtime registers', () => {
    const provider = new CloudflareAiProvider({
      resolveEndpoint: async () => ({ url: 'https://gw.test/v1/chat/completions', token: 'tok' }),
      resolveModel: async (providerName, model) => ({ provider: providerName, id: model, name: model }),
      listModels: async () => [],
      transmit: async () => new Response(null, { status: 500 }),
      headerOptions: {},
      streamIdleTimeoutMs: 5000,
    })
    expect(provider).toBeInstanceOf(LlmAdapter)
  })
})

describe('readErrorDetail composite bodies', () => {
  it('joins the detail of both shapes when a body carries an error object and an envelope', () => {
    const body = JSON.stringify({
      error: { code: 'rate_limit', type: 'requests', message: 'slow' },
      errors: [{ code: 1, message: 'bad model' }],
    })
    expect(readErrorDetail(429, body)).toBe('HTTP 429 rate_limit requests slow bad model')
  })

  it('reports the status alone for an envelope whose entries carry no message', () => {
    expect(readErrorDetail(400, JSON.stringify({ errors: [{ code: 1 }] }))).toBe('HTTP 400')
  })
})

/**
 * The contract the harness runtime relies on when it registers and drives the
 * Cloudflare model provider.
 *
 * The behavioural suites (`ai-provider`, `ai-provider-stream`, `ai-plugin`)
 * assert what the provider does; this suite asserts the registered shape
 * itself: that the class really extends the runtime base `LlmAdapter`, and
 * that the error-detail reader the package publishes tolerates every body
 * shape a failed provider response can arrive in — the composite shapes the
 * single-shape cases do not cover, and the shapes that are JSON but carry no
 * detail at all.
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { readErrorDetail } from '../src/ai/provider.ts'
import { makeProvider } from './ai-provider-support.ts'

describe('registered base', () => {
  // The fixture factory builds the class under test, so the assertion is on
  // that class rather than on a second construction of it: a provider that
  // stopped extending the runtime base would fail here.
  it('extends LlmAdapter, the base the harness runtime registers', () => {
    const { provider } = makeProvider()
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

describe('readErrorDetail bodies that carry no readable detail', () => {
  it.each([
    ['a JSON scalar', '12'],
    ['a JSON array', '[1,2]'],
    ['an error member that is not an object', JSON.stringify({ error: 'nope' })],
    ['an envelope that is not an array', JSON.stringify({ errors: 'boom' })],
    ['an envelope entry that is not an object', JSON.stringify({ errors: ['boom'] })],
  ])('reports the status alone for %s', (_label, body) => {
    expect(readErrorDetail(400, body)).toBe('HTTP 400')
  })
})

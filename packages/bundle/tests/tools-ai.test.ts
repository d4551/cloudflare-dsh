/**
 * `cloudflare_ai_run`: execution, the streaming refusal, and rendering.
 */
import { describe, expect, it } from 'vitest'
import { json } from '../src/tools/_shared/render.ts'
import * as aiTools from '../src/tools/ai/index.ts'
import { envelope, failure, makeHarness } from './harness.ts'

describe('cloudflare_ai_run', () => {
  it('refuses a streaming request, which its single response could not carry', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await expect(
      h.run('cloudflare_ai_run', { model: '@cf/meta/m', input: { prompt: 'hi', stream: true } }),
    ).rejects.toThrow(
      'cloudflare_ai_run returns one complete response; a streamed completion comes from the cloudflare-workers-ai model provider instead',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('names the streaming refusal so a caller can tell it from a provider failure', () => {
    expect(new aiTools.AiRunStreamError()).toMatchObject({ name: 'AiRunStreamError' })
  })

  it('runs a model and returns its output', async () => {
    const h = makeHarness(aiTools, async () => envelope({ response: 'hi' }))
    await expect(
      h.run('cloudflare_ai_run', {
        model: '@cf/meta/llama-3.1-8b-instruct',
        input: { prompt: 'x' },
      }),
    ).resolves.toEqual({
      model: '@cf/meta/llama-3.1-8b-instruct',
      output: { response: 'hi' },
    })
  })

  it('posts to the account-scoped run path with the slug preserved', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', { model: '@cf/meta/m', input: {} })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/ai/run/%40cf/meta/m')
  })

  it('sends the input as the request body', async () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    await h.run('cloudflare_ai_run', {
      model: '@cf/m',
      input: { prompt: 'x' },
    })
    await expect(h.requests[0]!.text()).resolves.toBe('{"prompt":"x"}')
  })

  it('renders the model output as JSON', () => {
    const h = makeHarness(aiTools, async () => envelope({}))
    expect(
      h.render('cloudflare_ai_run', { model: 'm', input: {} }, { model: 'm', output: { a: 1 } }),
    ).toEqual(json({ a: 1 }))
  })

  it('surfaces a model error', async () => {
    const h = makeHarness(aiTools, async () => failure(5006, 'model not found', 404))
    await expect(h.run('cloudflare_ai_run', { model: '@cf/nope', input: {} })).rejects.toThrow(
      'model not found',
    )
  })
})

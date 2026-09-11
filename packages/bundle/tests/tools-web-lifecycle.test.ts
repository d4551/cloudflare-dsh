import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as webTools from '../src/tools/web.ts'
import { envelope, makeHarness } from './harness.ts'

interface ToolsContext extends Context {
  tools: ToolRuntime
}

describe('lifecycle', () => {
  it('registers with the real tool runtime and is released when the fiber unloads', async () => {
    // The registry records each registration as an effect on the calling
    // plugin's fiber; this proves that guarantee end to end for a tool plugin,
    // which the recording fake cannot show.
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      section: () => () => '',
      getSectionOrder: () => 0,
      tools: () => () => [],
    })
    await ctx.plugin(ToolRuntime)
    const credentials = { resolve: () => 'tok' }
    ctx.provide('credentials', credentials)
    const service = new CloudflareService(
      ctx,
      CloudflareConfig({ accountId: 'a1', baseUrl: 'https://api.test/v4' }),
      {
        credentials,
        fetch: async () => envelope(''),
      },
    )
    expect(service.name).toBe('cloudflare')
    const tools = (ctx as ToolsContext).tools

    const fiber = await ctx.plugin(webTools)
    expect(tools.get('cloudflare_browser_render')?.name).toBe('cloudflare_browser_render')
    expect(tools.get('cloudflare_browser_screenshot')?.name).toBe('cloudflare_browser_screenshot')
    expect(tools.get('cloudflare_browser_accessibility_tree')?.name).toBe(
      'cloudflare_browser_accessibility_tree',
    )
    await fiber.dispose()
    expect(tools.get('cloudflare_browser_render')).toBeUndefined()
    expect(tools.get('cloudflare_browser_screenshot')).toBeUndefined()
    expect(tools.get('cloudflare_browser_accessibility_tree')).toBeUndefined()
  })
})

/** A harness for reading a tool's declarations; it never calls Cloudflare. */
const viewHarness = () => makeHarness(webTools, async () => envelope(''))

describe('what the tool views are given', () => {
  it('publishes the rendered text beside the page it came from', () => {
    const meta = viewHarness()
      .tool('cloudflare_browser_render')
      .output.presentationMeta?.(
        { url: 'https://x.test', format: 'markdown' },
        { url: 'https://x.test', format: 'markdown', body: '# Title' },
      )
    expect(meta).toEqual({ url: 'https://x.test', body: '# Title' })
  })

  it('publishes a structured body as the JSON a reader would look at', () => {
    // `links` and `json` answer with structured data, and the view shows text.
    const meta = viewHarness()
      .tool('cloudflare_browser_render')
      .output.presentationMeta?.(
        { url: 'https://x.test', format: 'links' },
        { url: 'https://x.test', format: 'links', body: ['a', 'b'] },
      )
    expect(meta).toEqual({ url: 'https://x.test', body: '[\n  "a",\n  "b"\n]' })
  })

  it('publishes the accessibility tree, which the bounded render text cannot be rebuilt from', () => {
    const tree = { role: 'document', children: [{ role: 'heading' }] }
    const meta = viewHarness()
      .tool('cloudflare_browser_accessibility_tree')
      .output.presentationMeta?.({ url: 'https://x.test' }, { url: 'https://x.test', tree })
    expect(meta).toEqual({ url: 'https://x.test', tree })
  })
})

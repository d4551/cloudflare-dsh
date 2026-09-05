import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as webTools from '../src/tools/web.ts'
import { envelope, makeHarness } from './harness.ts'

interface ToolsContext extends Context {
  tools: ToolRuntime
}

describe('web tools plugin', () => {
  it('declares its name and injections', () => {
    expect(webTools.name).toBe('cloudflare-tools-web')
    expect(webTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers both rendering tools', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(h.names().toSorted()).toEqual([
      'cloudflare_browser_accessibility_tree',
      'cloudflare_browser_render',
    ])
  })

  it('gives both tools a generous timeout, since real Chrome is slow', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(h.tool('cloudflare_browser_render').timeoutMs).toBe(120_000)
    expect(h.tool('cloudflare_browser_accessibility_tree').timeoutMs).toBe(120_000)
  })

  it('marks both as concurrency safe', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(
      h.tool('cloudflare_browser_render').isConcurrencySafe?.({ url: 'https://x.test', format: 'markdown' }),
    ).toBe(true)
    expect(
      h.tool('cloudflare_browser_accessibility_tree').isConcurrencySafe?.({ url: 'https://x.test' }),
    ).toBe(true)
  })
})

describe('renderOptionsFrom', () => {
  it('carries only the url when nothing else is given', () => {
    expect(webTools.renderOptionsFrom({ url: 'https://x.test' })).toStrictEqual({
      url: 'https://x.test',
      gotoTimeoutMs: undefined,
      waitForSelector: undefined,
      rejectResourceTypes: undefined,
    })
  })

  it('carries the timeout and selector when given', () => {
    expect(
      webTools.renderOptionsFrom({
        url: 'https://x.test',
        gotoTimeoutMs: 10,
        waitForSelector: 'main',
        rejectResourceTypes: ['image'],
      }),
    ).toStrictEqual({
      url: 'https://x.test',
      gotoTimeoutMs: 10,
      waitForSelector: 'main',
      rejectResourceTypes: ['image'],
    })
  })
})

describe('cloudflare_browser_render', () => {
  it('renders markdown and returns the body with its provenance', async () => {
    const h = makeHarness(webTools, async () => envelope('# Title'))
    await expect(
      h.run('cloudflare_browser_render', { url: 'https://x.test', format: 'markdown' }),
    ).resolves.toEqual({ url: 'https://x.test', format: 'markdown', body: '# Title' })
  })

  it('posts to the account-scoped rendering endpoint', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await h.run('cloudflare_browser_render', { url: 'https://x.test', format: 'markdown' })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/browser-rendering/markdown')
    expect(h.requests[0]!.method).toBe('POST')
  })

  it('forwards the resource types to block', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await h.run('cloudflare_browser_render', {
      url: 'https://x.test',
      format: 'content',
      rejectResourceTypes: ['image', 'script'],
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","rejectResourceTypes":["image","script"]}',
    )
  })

  it('rejects a resource type outside the documented set before any request', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await expect(
      h.run('cloudflare_browser_render', {
        url: 'https://x.test',
        format: 'content',
        rejectResourceTypes: ['video'],
      }),
    ).rejects.toThrow(
      'invalid arguments: "rejectResourceTypes[0]" must be one of ["document","stylesheet","image","media","font","script","texttrack","xhr","fetch","prefetch","eventsource","websocket","manifest","signedexchange","ping","cspviolationreport","preflight","other"]',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('forwards navigation options', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await h.run('cloudflare_browser_render', {
      url: 'https://x.test',
      format: 'content',
      gotoTimeoutMs: 5000,
      waitForSelector: 'main',
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","gotoOptions":{"timeout":5000,"waitUntil":"networkidle0"},"waitForSelector":{"selector":"main"}}',
    )
  })

  it('renders a string body as text', () => {
    const h = makeHarness(webTools, async () => envelope(''))
    const blocks = h.render(
      'cloudflare_browser_render',
      { url: 'u', format: 'markdown' },
      { url: 'u', format: 'markdown', body: 'hello' },
    )
    expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('renders a structured body as JSON', () => {
    const h = makeHarness(webTools, async () => envelope(''))
    const blocks = h.render(
      'cloudflare_browser_render',
      { url: 'u', format: 'links' },
      { url: 'u', format: 'links', body: ['a'] },
    )
    expect(blocks).toEqual([{ type: 'text', text: '[\n  "a"\n]' }])
  })

  it('truncates a very long rendered page', () => {
    const h = makeHarness(webTools, async () => envelope(''))
    const blocks = h.render(
      'cloudflare_browser_render',
      { url: 'u', format: 'markdown' },
      { url: 'u', format: 'markdown', body: 'x'.repeat(9000) },
    )
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 1000 characters') }])
  })

  it('rejects a format outside the supported set', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await expect(
      h.run('cloudflare_browser_render', { url: 'https://x.test', format: 'exe' }),
    ).rejects.toThrow(
      'invalid arguments: "format" must be one of ["markdown","content","links","screenshot","pdf","scrape","json"]',
    )
    expect(h.requests).toHaveLength(0)
  })
})

describe('cloudflare_browser_accessibility_tree', () => {
  it('returns the tree with the url that produced it', async () => {
    const h = makeHarness(webTools, async () => envelope({ role: 'document' }))
    await expect(h.run('cloudflare_browser_accessibility_tree', { url: 'https://x.test' })).resolves.toEqual({
      url: 'https://x.test',
      tree: { role: 'document' },
    })
  })

  it('posts to the camelCase accessibility endpoint', async () => {
    const h = makeHarness(webTools, async () => envelope({}))
    await h.run('cloudflare_browser_accessibility_tree', { url: 'https://x.test' })
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/browser-rendering/accessibilityTree')
  })

  it('renders the url then the tree', () => {
    const h = makeHarness(webTools, async () => envelope({}))
    const blocks = h.render(
      'cloudflare_browser_accessibility_tree',
      { url: 'https://x.test' },
      { url: 'https://x.test', tree: { role: 'main' } },
    )
    expect(blocks).toEqual([
      { type: 'text', text: 'Accessibility tree for https://x.test\n{\n  "role": "main"\n}' },
    ])
  })

  it('truncates a very large tree', () => {
    const h = makeHarness(webTools, async () => envelope({}))
    const big = { role: 'x'.repeat(9000) }
    const blocks = h.render('cloudflare_browser_accessibility_tree', { url: 'u' }, { url: 'u', tree: big })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated') }])
  })
})

describe('lifecycle', () => {
  it('registers with the real tool runtime and is released when the fiber unloads', async () => {
    // The registry records each registration as an effect on the calling
    // plugin's fiber; this proves that guarantee end to end for a tool plugin
    // rather than trusting the recording fake.
    const ctx = new Context()
    ctx.provide('systemPrompt', {
      section: () => () => {},
      getSectionOrder: () => 0,
      tools: () => () => {},
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
    expect(tools.get('cloudflare_browser_accessibility_tree')?.name).toBe(
      'cloudflare_browser_accessibility_tree',
    )
    await fiber.dispose()
    expect(tools.get('cloudflare_browser_render')).toBeUndefined()
    expect(tools.get('cloudflare_browser_accessibility_tree')).toBeUndefined()
  })
})

describe('WebToolsConfig', () => {
  it('defaults every tunable the tools used to hard-code', () => {
    expect(webTools.Config({})).toStrictEqual({ renderLimit: 8000, renderTimeoutMs: 120_000 })
  })

  it('rejects a zero render limit at configuration time', () => {
    expect(() => webTools.Config({ renderLimit: 0 })).toThrow('$.renderLimit expected number >= 1 but got 0')
  })

  it('applies a configured render budget to both tools', () => {
    const h = makeHarness(webTools, async () => envelope(''), {}, { renderTimeoutMs: 5_000 })
    expect(h.tool('cloudflare_browser_render').timeoutMs).toBe(5_000)
    expect(h.tool('cloudflare_browser_accessibility_tree').timeoutMs).toBe(5_000)
  })

  it('applies a configured render limit to a rendered page', () => {
    const h = makeHarness(webTools, async () => envelope(''), {}, { renderLimit: 4 })
    const blocks = h.render(
      'cloudflare_browser_render',
      { url: 'u', format: 'markdown' },
      { url: 'u', format: 'markdown', body: 'x'.repeat(10) },
    )
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 6 characters') }])
  })
})

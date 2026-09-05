import { describe, expect, it } from 'vitest'
import * as webTools from '../src/tools/web.ts'
import { envelope, makeHarness } from './harness.ts'

describe('web tools plugin', () => {
  it('declares its name and injections', () => {
    expect(webTools.name).toBe('cloudflare-tools-web')
    expect(webTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers both rendering tools', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect([...h.tools.keys()].sort()).toEqual([
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
    expect(h.tool('cloudflare_browser_render').isConcurrencySafe?.({ url: 'https://x.test', format: 'markdown' })).toBe(true)
    expect(h.tool('cloudflare_browser_accessibility_tree').isConcurrencySafe?.({ url: 'https://x.test' })).toBe(true)
  })
})

describe('renderOptionsFrom', () => {
  it('carries only the url when nothing else is given', () => {
    expect(webTools.renderOptionsFrom({ url: 'https://x.test' })).toStrictEqual({
      url: 'https://x.test',
      gotoTimeoutMs: undefined,
      waitForSelector: undefined,
    })
  })

  it('carries the timeout and selector when given', () => {
    expect(
      webTools.renderOptionsFrom({ url: 'https://x.test', gotoTimeoutMs: 10, waitForSelector: 'main' }),
    ).toStrictEqual({ url: 'https://x.test', gotoTimeoutMs: 10, waitForSelector: 'main' })
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
    const blocks = h
      .tool('cloudflare_browser_render')
      .output.render({ url: 'u', format: 'markdown' }, { url: 'u', format: 'markdown', body: 'hello' })
    expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('renders a structured body as JSON', () => {
    const h = makeHarness(webTools, async () => envelope(''))
    const blocks = h
      .tool('cloudflare_browser_render')
      .output.render({ url: 'u', format: 'links' }, { url: 'u', format: 'links', body: ['a'] })
    expect(blocks).toEqual([{ type: 'text', text: '[\n  "a"\n]' }])
  })

  it('truncates a very long rendered page', () => {
    const h = makeHarness(webTools, async () => envelope(''))
    const blocks = h
      .tool('cloudflare_browser_render')
      .output.render({ url: 'u', format: 'markdown' }, { url: 'u', format: 'markdown', body: 'x'.repeat(9000) })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated 1000 characters') }])
  })

  it('rejects a format outside the supported set', async () => {
    const h = makeHarness(webTools, async () => envelope(''))
    await expect(h.run('cloudflare_browser_render', { url: 'https://x.test', format: 'exe' })).rejects.toThrow()
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
    const blocks = h
      .tool('cloudflare_browser_accessibility_tree')
      .output.render({ url: 'https://x.test' }, { url: 'https://x.test', tree: { role: 'main' } })
    expect(blocks).toEqual([
      { type: 'text', text: 'Accessibility tree for https://x.test\n{\n  "role": "main"\n}' },
    ])
  })

  it('truncates a very large tree', () => {
    const h = makeHarness(webTools, async () => envelope({}))
    const big = { role: 'x'.repeat(9000) }
    const blocks = h
      .tool('cloudflare_browser_accessibility_tree')
      .output.render({ url: 'u' }, { url: 'u', tree: big })
    expect(blocks).toEqual([{ type: 'text', text: expect.stringContaining('truncated') }])
  })
})

import { describe, expect, it } from 'vitest'
import * as webTools from '../src/tools/web.ts'
import { PNG_1X1, envelope, makeHarness } from './harness.ts'

describe('web tools plugin', () => {
  it('declares its name and injections', () => {
    expect(webTools.name).toBe('cloudflare-tools-web')
    expect(webTools.inject).toEqual(['tools', 'cloudflare'])
  })

  it('registers the three browser tools', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(h.names().toSorted()).toEqual([
      'cloudflare_browser_accessibility_tree',
      'cloudflare_browser_render',
      'cloudflare_browser_screenshot',
    ])
  })

  it('gives every tool a generous timeout, since real Chrome is slow', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(h.tool('cloudflare_browser_render').timeoutMs).toBe(120_000)
    expect(h.tool('cloudflare_browser_screenshot').timeoutMs).toBe(120_000)
    expect(h.tool('cloudflare_browser_accessibility_tree').timeoutMs).toBe(120_000)
  })

  it('marks every tool as concurrency safe', () => {
    const h = makeHarness(webTools, async () => envelope(null))
    expect(
      h.tool('cloudflare_browser_render').isConcurrencySafe?.({ url: 'https://x.test', format: 'markdown' }),
    ).toBe(true)
    expect(h.tool('cloudflare_browser_screenshot').isConcurrencySafe?.({ url: 'https://x.test' })).toBe(true)
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
      'invalid arguments: "format" must be one of ["markdown","content","links","scrape","json"]',
    )
    expect(h.requests).toHaveLength(0)
  })
})

/** The screenshot endpoint's answer: image bytes under the declared type, or under none when `null`. */
function image(contentType: string | null = 'image/png', bytes: Uint8Array<ArrayBuffer> = PNG_1X1): Response {
  return new Response(bytes, {
    status: 200,
    ...(contentType === null ? {} : { headers: { 'content-type': contentType } }),
  })
}

const SHOT = { url: 'https://x.test' }

describe('cloudflare_browser_screenshot', () => {
  it('posts to the screenshot endpoint asking for the image type', async () => {
    const h = makeHarness(webTools, async () => image())
    await h.run('cloudflare_browser_screenshot', SHOT)
    expect(h.requests[0]!.url).toBe('https://api.test/v4/accounts/a1/browser-rendering/screenshot')
    expect(h.requests[0]!.method).toBe('POST')
    expect(h.requests[0]!.headers.get('accept')).toBe('image/png')
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","screenshotOptions":{"type":"png","fullPage":false}}',
    )
  })

  it('stores the image and returns the reference field by field', async () => {
    const h = makeHarness(webTools, async () => image())
    await expect(h.run('cloudflare_browser_screenshot', SHOT)).resolves.toEqual({
      url: 'https://x.test',
      attachmentId: 'sha256:497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581',
      mediaType: 'image/png',
      bytes: 70,
      width: 1,
      height: 1,
    })
    expect(h.attachments?.saved).toEqual([{ data: PNG_1X1, mediaType: 'image/png' }])
  })

  it('honours the type and full-page choices of the call', async () => {
    const h = makeHarness(webTools, async () => image('image/jpeg'))
    await h.run('cloudflare_browser_screenshot', { ...SHOT, type: 'jpeg', fullPage: true })
    expect(h.requests[0]!.headers.get('accept')).toBe('image/jpeg')
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","screenshotOptions":{"type":"jpeg","fullPage":true}}',
    )
  })

  it('forwards navigation options and resource blocks like the other tools', async () => {
    const h = makeHarness(webTools, async () => image())
    await h.run('cloudflare_browser_screenshot', {
      ...SHOT,
      gotoTimeoutMs: 5000,
      waitForSelector: 'main',
      rejectResourceTypes: ['font'],
    })
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","gotoOptions":{"timeout":5000,"waitUntil":"networkidle0"},"waitForSelector":{"selector":"main"},"rejectResourceTypes":["font"],"screenshotOptions":{"type":"png","fullPage":false}}',
    )
  })

  it('rejects an image type outside the documented set before any request', async () => {
    const h = makeHarness(webTools, async () => image())
    await expect(h.run('cloudflare_browser_screenshot', { ...SHOT, type: 'gif' })).rejects.toThrow(
      'invalid arguments: "type" must be one of ["png","jpeg","webp"]',
    )
    expect(h.requests).toHaveLength(0)
  })

  it.each([
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/webp', 'image/webp'],
    ['IMAGE/PNG; charset=binary', 'image/png'],
  ])('declares the type Cloudflare answered with, %s, to the store as %s', async (answered, declared) => {
    const h = makeHarness(webTools, async () => image(answered))
    await expect(h.run('cloudflare_browser_screenshot', SHOT)).resolves.toMatchObject({ mediaType: declared })
    expect(h.attachments?.saved[0]?.mediaType).toBe(declared)
  })

  it('refuses an answer that is not an image, and stores nothing', async () => {
    const h = makeHarness(webTools, async () => image('application/json', new TextEncoder().encode('{}')))
    await expect(h.run('cloudflare_browser_screenshot', SHOT)).rejects.toThrow(
      'Cloudflare answered the screenshot request with application/json rather than an image',
    )
    expect(h.attachments?.saved).toEqual([])
  })

  it('refuses an answer without a content type, and stores nothing', async () => {
    const h = makeHarness(webTools, async () => image(null))
    await expect(h.run('cloudflare_browser_screenshot', SHOT)).rejects.toThrow(
      'Cloudflare answered the screenshot request without a content type',
    )
    expect(h.attachments?.saved).toEqual([])
  })

  it('fails before any request when no attachment store is mounted', async () => {
    const h = makeHarness(webTools, async () => image(), {}, {}, { attachments: false })
    await expect(h.run('cloudflare_browser_screenshot', SHOT)).rejects.toThrow(
      'cloudflare_browser_screenshot keeps the image in the attachment store, and none is mounted; mount @deepseek-ai/dsh-attachment-local or another provider of ctx.attachments',
    )
    expect(h.requests).toHaveLength(0)
  })

  it('renders a summary line and the image block that lets a capable route see the page', () => {
    const h = makeHarness(webTools, async () => image())
    const blocks = h.render('cloudflare_browser_screenshot', SHOT, {
      url: 'https://x.test',
      attachmentId: 'sha256:497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581',
      mediaType: 'image/png',
      bytes: 70,
      width: 1,
      height: 1,
    })
    expect(blocks).toEqual([
      { type: 'text', text: 'Screenshot of https://x.test: 1×1 image/png, 70 bytes.' },
      {
        type: 'image',
        attachment: {
          attachmentId: 'sha256:497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581',
          mediaType: 'image/png',
          bytes: 70,
          width: 1,
          height: 1,
        },
      },
    ])
  })

  it.each([
    ['NoAttachmentStoreError', new webTools.NoAttachmentStoreError()],
    ['ScreenshotShapeError', new webTools.ScreenshotShapeError(null)],
  ])('names its %s so a caller can tell it from a provider failure', (name, error) => {
    expect(error).toMatchObject({ name })
  })
})

describe('screenshotMediaType', () => {
  it.each([
    ['image/png', 'image/png'],
    ['image/jpeg', 'image/jpeg'],
    ['image/jpg', 'image/jpeg'],
    ['image/webp', 'image/webp'],
    [' Image/WebP ; q=1', 'image/webp'],
  ])('maps %s to %s', (contentType, mediaType) => {
    expect(webTools.screenshotMediaType(contentType)).toBe(mediaType)
  })

  it.each([
    ['null', null],
    ['a GIF, which a screenshot never is', 'image/gif'],
    ['JSON', 'application/json'],
    ['text', 'text/plain'],
  ])('maps %s to undefined', (_label, contentType) => {
    expect(webTools.screenshotMediaType(contentType)).toBeUndefined()
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

describe('WebToolsConfig', () => {
  it('defaults every tunable the tools no longer write into the source', () => {
    expect(webTools.Config({})).toStrictEqual({
      renderLimit: 8000,
      renderTimeoutMs: 120_000,
      screenshotType: 'png',
      screenshotFullPage: false,
    })
  })

  it('applies the configured screenshot defaults to a call that chooses neither', async () => {
    const h = makeHarness(
      webTools,
      async () => image('image/webp'),
      {},
      { screenshotType: 'webp', screenshotFullPage: true },
    )
    await h.run('cloudflare_browser_screenshot', SHOT)
    expect(h.requests[0]!.headers.get('accept')).toBe('image/webp')
    await expect(h.requests[0]!.text()).resolves.toBe(
      '{"url":"https://x.test","screenshotOptions":{"type":"webp","fullPage":true}}',
    )
  })

  it('rejects a zero render limit at configuration time', () => {
    expect(() => webTools.Config({ renderLimit: 0 })).toThrow('$.renderLimit expected number >= 1 but got 0')
  })

  it('applies a configured render budget to every tool', () => {
    const h = makeHarness(webTools, async () => envelope(''), {}, { renderTimeoutMs: 5_000 })
    expect(h.tool('cloudflare_browser_render').timeoutMs).toBe(5_000)
    expect(h.tool('cloudflare_browser_screenshot').timeoutMs).toBe(5_000)
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

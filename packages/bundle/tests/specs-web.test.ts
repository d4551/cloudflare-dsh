import { describe, expect, it } from 'vitest'
import { accessibilityTreeSpec, browserRenderSpec, renderBody } from '../src/specs/web.ts'

describe('renderBody', () => {
  it('sends only the url when no options are given', () => {
    expect(renderBody({ url: 'https://x.test' })).toStrictEqual({ url: 'https://x.test' })
  })

  it('adds goto options when a timeout is given', () => {
    expect(renderBody({ url: 'https://x.test', gotoTimeoutMs: 5000 })).toStrictEqual({
      url: 'https://x.test',
      gotoOptions: { timeout: 5000, waitUntil: 'networkidle0' },
    })
  })

  it('adds a selector wait when one is given', () => {
    expect(renderBody({ url: 'https://x.test', waitForSelector: 'main' })).toStrictEqual({
      url: 'https://x.test',
      waitForSelector: { selector: 'main' },
    })
  })

  it('adds resource-type rejections when given', () => {
    expect(renderBody({ url: 'https://x.test', rejectResourceTypes: ['image'] })).toStrictEqual({
      url: 'https://x.test',
      rejectResourceTypes: ['image'],
    })
  })

  it('combines every option', () => {
    expect(
      renderBody({
        url: 'https://x.test',
        gotoTimeoutMs: 1,
        waitForSelector: 'main',
        rejectResourceTypes: ['font'],
      }),
    ).toStrictEqual({
      url: 'https://x.test',
      gotoOptions: { timeout: 1, waitUntil: 'networkidle0' },
      waitForSelector: { selector: 'main' },
      rejectResourceTypes: ['font'],
    })
  })
})

describe('browserRenderSpec', () => {
  it.each(['markdown', 'content', 'links', 'screenshot', 'pdf', 'scrape', 'json'] as const)(
    'posts to the %s endpoint',
    (format) => {
      expect(browserRenderSpec(format, { url: 'https://x.test' })).toStrictEqual({
        method: 'POST',
        path: `/browser-rendering/${format}`,
        body: { url: 'https://x.test' },
      })
    },
  )
})

describe('accessibilityTreeSpec', () => {
  it('uses the camelCase path segment, unlike the other rendering endpoints', () => {
    expect(accessibilityTreeSpec({ url: 'https://x.test' })).toStrictEqual({
      method: 'POST',
      path: '/browser-rendering/accessibilityTree',
      body: { url: 'https://x.test' },
    })
  })

  it('carries render options through', () => {
    expect(accessibilityTreeSpec({ url: 'https://x.test', waitForSelector: '#app' }).body).toStrictEqual({
      url: 'https://x.test',
      waitForSelector: { selector: '#app' },
    })
  })
})

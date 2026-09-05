/**
 * Pure request-spec builders for the Browser Rendering tools.
 *
 * The REST paths are account-scoped — `/accounts/{id}/browser-rendering/...` —
 * and the accessibility endpoint is camelCase where the rest are lower-case.
 */
import type { RequestSpec } from '@d4551/dsh-cloudflare-core'

/** Endpoints that turn a URL into content. */
export type RenderFormat = 'markdown' | 'content' | 'links' | 'screenshot' | 'pdf' | 'scrape' | 'json'

/** Options shared by every rendering call. */
export interface RenderOptions {
  readonly url: string
  readonly gotoTimeoutMs?: number | undefined
  readonly waitForSelector?: string | undefined
  readonly rejectResourceTypes?: readonly string[] | undefined
}

/** Build the body common to the rendering endpoints. */
export function renderBody(options: RenderOptions): Record<string, unknown> {
  return {
    url: options.url,
    ...(options.gotoTimeoutMs === undefined
      ? {}
      : { gotoOptions: { timeout: options.gotoTimeoutMs, waitUntil: 'networkidle0' } }),
    ...(options.waitForSelector === undefined
      ? {}
      : { waitForSelector: { selector: options.waitForSelector } }),
    ...(options.rejectResourceTypes === undefined
      ? {}
      : { rejectResourceTypes: options.rejectResourceTypes }),
  }
}

/** Render a page in the requested format. */
export function browserRenderSpec(format: RenderFormat, options: RenderOptions): RequestSpec {
  return { method: 'POST', path: `/browser-rendering/${format}`, body: renderBody(options) }
}

/**
 * Fetch the accessibility tree for a page.
 *
 * The path segment is camelCase, unlike every other rendering endpoint.
 */
export function accessibilityTreeSpec(options: RenderOptions): RequestSpec {
  return { method: 'POST', path: '/browser-rendering/accessibilityTree', body: renderBody(options) }
}

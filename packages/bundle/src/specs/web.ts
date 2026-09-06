/**
 * Pure request-spec builders for the Browser Rendering tools.
 *
 * The REST paths are account-scoped — `/accounts/{id}/browser-rendering/...` —
 * and the accessibility endpoint is camelCase where the rest are lower-case.
 */
import type { RequestSpec } from '@d4551/dsh-cloudflare-core'

/**
 * Endpoints that turn a URL into a JSON envelope. `screenshot` and `pdf` are
 * not among them: both answer with bytes, so the screenshot has its own spec
 * and the PDF is not offered (see the tool module for why).
 */
export type RenderFormat = 'markdown' | 'content' | 'links' | 'scrape' | 'json'

/** Image encodings the screenshot endpoint produces. */
export type ScreenshotType = 'png' | 'jpeg' | 'webp'

/** Every {@link ScreenshotType}, in the order the API documents them. */
export const SCREENSHOT_TYPES: readonly ScreenshotType[] = ['png', 'jpeg', 'webp']

/** What a screenshot request asks of the page. */
export interface ScreenshotOptions {
  readonly type: ScreenshotType
  /** The whole scrollable page rather than the viewport. */
  readonly fullPage: boolean
}

/**
 * Resource types Browser Rendering can be told to block.
 *
 * The set Cloudflare's API accepts for `rejectResourceTypes`, from its
 * published client types; the enum in the tool schema is built from it so a
 * misspelling fails compilation rather than a request.
 */
type ResourceType =
  | 'document'
  | 'stylesheet'
  | 'image'
  | 'media'
  | 'font'
  | 'script'
  | 'texttrack'
  | 'xhr'
  | 'fetch'
  | 'prefetch'
  | 'eventsource'
  | 'websocket'
  | 'manifest'
  | 'signedexchange'
  | 'ping'
  | 'cspviolationreport'
  | 'preflight'
  | 'other'

/** Every {@link ResourceType}, in the order the API documents them. */
export const RESOURCE_TYPES: readonly ResourceType[] = [
  'document',
  'stylesheet',
  'image',
  'media',
  'font',
  'script',
  'texttrack',
  'xhr',
  'fetch',
  'prefetch',
  'eventsource',
  'websocket',
  'manifest',
  'signedexchange',
  'ping',
  'cspviolationreport',
  'preflight',
  'other',
]

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
 * Capture a screenshot of a page.
 *
 * The endpoint answers with the image bytes, so the spec asks for that image
 * type rather than the JSON every other rendering call reads.
 */
export function browserScreenshotSpec(options: RenderOptions, shot: ScreenshotOptions): RequestSpec {
  return {
    method: 'POST',
    path: '/browser-rendering/screenshot',
    body: { ...renderBody(options), screenshotOptions: { type: shot.type, fullPage: shot.fullPage } },
    accept: `image/${shot.type}`,
  }
}

/**
 * Fetch the accessibility tree for a page.
 *
 * The path segment is camelCase, unlike every other rendering endpoint.
 */
export function accessibilityTreeSpec(options: RenderOptions): RequestSpec {
  return { method: 'POST', path: '/browser-rendering/accessibilityTree', body: renderBody(options) }
}

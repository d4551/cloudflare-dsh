/**
 * Browser Rendering tools.
 *
 * These give an agent a real headless Chrome: fetch a page as markdown, take a
 * screenshot, or — the one worth calling out — pull the accessibility tree of
 * any URL, which makes automated WCAG review possible from inside a session.
 *
 * A screenshot is bytes, and the harness has one durable home for bytes: the
 * attachment store, which admits raster images. The screenshot tool saves the
 * image there and returns an image block, so a route that accepts images sees
 * the page and the client can show it, while a text-only route is told the
 * image was omitted. A PDF is not a raster image, so the store cannot hold it
 * and a base64 PDF in the session log would be a blob nothing can consume;
 * PDF capture is therefore not offered rather than offered broken.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import {
  RESOURCE_TYPES,
  SCREENSHOT_TYPES,
  type RenderFormat,
  type RenderOptions,
  type ScreenshotOptions,
  type ScreenshotType,
  accessibilityTreeSpec,
  browserRenderSpec,
  browserScreenshotSpec,
} from '../specs/web.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, text, truncate } from './_shared/render.ts'

interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** Longest rendered body handed to the model; the canonical value keeps it all. */

/** Formats the render tool accepts, in the order they appear to the model. */
const FORMATS: readonly RenderFormat[] = ['markdown', 'content', 'links', 'scrape', 'json']

/** The image types a screenshot can be stored as; a screenshot is never a GIF. */
type ScreenshotMediaType = Exclude<ImageMediaType, 'image/gif'>

/** Every {@link ScreenshotMediaType}, for the output schema. */
const SCREENSHOT_MEDIA_TYPES: readonly ScreenshotMediaType[] = ['image/png', 'image/jpeg', 'image/webp']

/**
 * The media type Cloudflare declared for a screenshot, as the attachment store
 * names it. Cloudflare's own schema lists `image/jpg` beside `image/jpeg`, so
 * both map to the registered type. Parameters after `;` are not the type.
 */
export function screenshotMediaType(contentType: string | null): ScreenshotMediaType | undefined {
  if (contentType === null) return undefined
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  switch (type) {
    case 'image/png':
      return 'image/png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'image/jpeg'
    case 'image/webp':
      return 'image/webp'
    default:
      return undefined
  }
}

/** Raised when a screenshot is requested in a composition without an attachment store. */
export class NoAttachmentStoreError extends Error {
  override readonly name = 'NoAttachmentStoreError'
  constructor() {
    super(
      'cloudflare_browser_screenshot keeps the image in the attachment store, and none is mounted; mount @deepseek-ai/dsh-attachment-local or another provider of ctx.attachments',
    )
  }
}

/** Raised when the screenshot endpoint answers with something other than an image. */
export class ScreenshotShapeError extends TypeError {
  override readonly name = 'ScreenshotShapeError'
  constructor(contentType: string | null) {
    super(
      contentType === null
        ? 'Cloudflare answered the screenshot request without a content type'
        : `Cloudflare answered the screenshot request with ${contentType} rather than an image`,
    )
  }
}

export const name = 'cloudflare-tools-web'
export const inject = ['tools', 'cloudflare']

/** Read the shared rendering options out of validated tool arguments. */
export function renderOptionsFrom(args: {
  url: string
  gotoTimeoutMs?: number | undefined
  waitForSelector?: string | undefined
  rejectResourceTypes?: readonly string[] | undefined
}): RenderOptions {
  return {
    url: args.url,
    gotoTimeoutMs: args.gotoTimeoutMs,
    waitForSelector: args.waitForSelector,
    rejectResourceTypes: args.rejectResourceTypes,
  }
}

export interface WebToolsConfig {
  /** Characters of a rendered page or tree shown to the model before truncation. */
  renderLimit: number
  /** Cooperative budget for a real browser render. */
  renderTimeoutMs: number
  /** Image type of a screenshot when the call does not choose one. */
  screenshotType: ScreenshotType
  /** Whether a screenshot captures the whole page when the call does not say. */
  screenshotFullPage: boolean
}

export const Config: Schema<Partial<WebToolsConfig>, WebToolsConfig> = Schema.object({
  renderLimit: Schema.natural().min(1).default(8000),
  renderTimeoutMs: Schema.natural().min(1).default(120_000),
  screenshotType: Schema.union(SCREENSHOT_TYPES).default('png'),
  screenshotFullPage: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: WebToolsConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_browser_render',
      description:
        'Render a web page with Cloudflare Browser Rendering (real headless Chrome, so JavaScript runs). Use markdown for reading a page, links to enumerate its links, and cloudflare_browser_screenshot for a picture of it.',
      parameters: {
        url: { type: 'string', required: true, description: 'Absolute URL to render.' },
        format: {
          type: 'string',
          required: true,
          enum: FORMATS,
          description: 'What to return for the page.',
        },
        gotoTimeoutMs: { type: 'integer', description: 'Navigation timeout in milliseconds.' },
        waitForSelector: { type: 'string', description: 'Wait for this CSS selector before capturing.' },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: { type: 'string', enum: RESOURCE_TYPES },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The rendered result, plus the url and format that produced it.',
          properties: {
            url: { type: 'string', required: true, description: 'The URL that was rendered.' },
            format: {
              type: 'string',
              required: true,
              description: 'The format that was requested.',
              enum: FORMATS,
            },
            body: {
              type: 'json',
              required: true,
              description: 'The rendered body: text for text formats, structured data otherwise.',
            },
          },
        },
        render: (args, value) => {
          if (typeof value.body === 'string') return text(truncate(value.body, config.renderLimit))
          return json(value.body)
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: config.renderTimeoutMs,
      async execute(args, exec) {
        const body = await cf.accountRequest<JsonValue>({
          ...browserRenderSpec(args.format, renderOptionsFrom(args)),
          signal: exec.signal,
          timeoutMs: config.renderTimeoutMs,
        })
        return { url: args.url, format: args.format, body }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_browser_screenshot',
      description:
        'Capture a screenshot of a web page with Cloudflare Browser Rendering (real headless Chrome). The image is kept as a durable attachment and returned as an image block: a model that accepts images sees the page and the client can show it; a text-only model is told the image was omitted. Needs an attachment store in the composition.',
      parameters: {
        url: { type: 'string', required: true, description: 'Absolute URL to capture.' },
        type: {
          type: 'string',
          enum: SCREENSHOT_TYPES,
          description: 'Image encoding; the configured default (png unless changed) when omitted.',
        },
        fullPage: {
          type: 'boolean',
          description:
            'Capture the whole scrollable page rather than the viewport; the configured default when omitted.',
        },
        gotoTimeoutMs: { type: 'integer', description: 'Navigation timeout in milliseconds.' },
        waitForSelector: { type: 'string', description: 'Wait for this CSS selector before capturing.' },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: { type: 'string', enum: RESOURCE_TYPES },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The stored screenshot and the page it shows.',
          properties: {
            url: { type: 'string', required: true, description: 'The URL that was captured.' },
            attachmentId: {
              type: 'string',
              required: true,
              description: 'Durable attachment id of the stored image.',
            },
            mediaType: {
              type: 'string',
              required: true,
              enum: SCREENSHOT_MEDIA_TYPES,
              description: 'Media type of the stored image, verified from its bytes by the store.',
            },
            bytes: { type: 'integer', required: true, description: 'Encoded size in bytes.' },
            width: { type: 'integer', required: true, description: 'Width in pixels.' },
            height: { type: 'integer', required: true, description: 'Height in pixels.' },
          },
        },
        render: (_args, value): ContentBlock[] => [
          ...text(
            `Screenshot of ${value.url}: ${value.width}×${value.height} ${value.mediaType}, ${value.bytes} bytes.`,
          ),
          {
            type: 'image',
            attachment: {
              attachmentId: AttachmentId(value.attachmentId),
              mediaType: value.mediaType,
              bytes: value.bytes,
              width: value.width,
              height: value.height,
            },
          },
        ],
      },
      isConcurrencySafe: () => true,
      timeoutMs: config.renderTimeoutMs,
      async execute(args, exec) {
        // Looked up per call rather than injected: the store is optional for
        // the other two tools, and its providing fiber may load after this one.
        const store = ctx.get('attachments')
        if (store === undefined) throw new NoAttachmentStoreError()
        const shot: ScreenshotOptions = {
          type: args.type === undefined ? config.screenshotType : args.type,
          fullPage: args.fullPage === undefined ? config.screenshotFullPage : args.fullPage,
        }
        const { bytes, contentType } = await cf.accountRequestBytes({
          ...browserScreenshotSpec(renderOptionsFrom(args), shot),
          signal: exec.signal,
          timeoutMs: config.renderTimeoutMs,
        })
        const mediaType = screenshotMediaType(contentType)
        if (mediaType === undefined) throw new ScreenshotShapeError(contentType)
        // The store verifies the declared type against the bytes, so the type
        // it was given is the type it holds; the rest is read back from it.
        const ref = await store.saveImage({ data: bytes, mediaType })
        return {
          url: args.url,
          attachmentId: ref.attachmentId,
          mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_browser_accessibility_tree',
      description:
        'Fetch the accessibility tree for a web page using Cloudflare Browser Rendering. Returns the roles, names and structure a screen reader would expose, which is what WCAG review needs.',
      parameters: {
        url: { type: 'string', required: true, description: 'Absolute URL to inspect.' },
        gotoTimeoutMs: { type: 'integer', description: 'Navigation timeout in milliseconds.' },
        waitForSelector: { type: 'string', description: 'Wait for this CSS selector before inspecting.' },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: { type: 'string', enum: RESOURCE_TYPES },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The accessibility tree for the page.',
          properties: {
            url: { type: 'string', required: true, description: 'The URL that was inspected.' },
            tree: {
              type: 'json',
              required: true,
              description: 'The accessibility tree as the API returns it.',
            },
          },
        },
        render: (args, value) => {
          return text(
            `Accessibility tree for ${args.url}\n${truncate(JSON.stringify(value.tree, null, 2), config.renderLimit)}`,
          )
        },
      },
      isConcurrencySafe: () => true,
      timeoutMs: config.renderTimeoutMs,
      async execute(args, exec) {
        const tree = await cf.accountRequest<JsonValue>({
          ...accessibilityTreeSpec(renderOptionsFrom(args)),
          signal: exec.signal,
          timeoutMs: config.renderTimeoutMs,
        })
        return { url: args.url, tree }
      },
    }),
  )
}

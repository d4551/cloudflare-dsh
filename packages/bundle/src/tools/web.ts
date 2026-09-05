/**
 * Browser Rendering tools.
 *
 * These give an agent a real headless Chrome: fetch a page as markdown, take a
 * screenshot, or — the one worth calling out — pull the accessibility tree of
 * any URL, which makes automated WCAG review possible from inside a session.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import {
  RESOURCE_TYPES,
  type RenderFormat,
  type RenderOptions,
  accessibilityTreeSpec,
  browserRenderSpec,
} from '../specs/web.ts'
import type { JsonValue } from './_shared/json.ts'
import { json, text, truncate } from './_shared/render.ts'

interface CloudflareContext extends Context {
  cloudflare: CloudflareService
}

/** Longest rendered body handed to the model; the canonical value keeps it all. */

/** Formats the render tool accepts, in the order they appear to the model. */
const FORMATS: readonly RenderFormat[] = [
  'markdown',
  'content',
  'links',
  'screenshot',
  'pdf',
  'scrape',
  'json',
]

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
}

export const Config: Schema<Partial<WebToolsConfig>, WebToolsConfig> = Schema.object({
  renderLimit: Schema.natural().min(1).default(8000),
  renderTimeoutMs: Schema.natural().min(1).default(120_000),
})

export function apply(ctx: Context, config: WebToolsConfig): void {
  const cf = (ctx as CloudflareContext).cloudflare

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_browser_render',
      description:
        'Render a web page with Cloudflare Browser Rendering (real headless Chrome, so JavaScript runs). Use markdown for reading a page, links to enumerate its links, screenshot or pdf for a visual capture.',
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
      async execute(args) {
        const body = await cf.accountRequest<JsonValue>(
          browserRenderSpec(args.format, renderOptionsFrom(args)),
        )
        return { url: args.url, format: args.format, body }
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
      async execute(args) {
        const tree = await cf.accountRequest<JsonValue>(accessibilityTreeSpec(renderOptionsFrom(args)))
        return { url: args.url, tree }
      },
    }),
  )
}

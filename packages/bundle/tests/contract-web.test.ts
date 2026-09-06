import { describe, expect, it } from 'vitest'
import * as toolsModule from '../src/tools/web.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The model-facing contract for every tool in this module.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation, so they
 * are pinned explicitly rather than left to drift. Written out in full on
 * purpose: changing one has to be a deliberate edit visible in review.
 */
const CONTRACT: Record<string, { description: string; parameters: unknown; output: unknown }> = {
  cloudflare_browser_accessibility_tree: {
    description:
      'Fetch the accessibility tree for a web page using Cloudflare Browser Rendering. Returns the roles, names and structure a screen reader would expose, which is what WCAG review needs.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL to inspect.',
        },
        gotoTimeoutMs: {
          type: 'integer',
          description: 'Navigation timeout in milliseconds.',
        },
        waitForSelector: {
          type: 'string',
          description: 'Wait for this CSS selector before inspecting.',
        },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: {
            type: 'string',
            enum: [
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
            ],
          },
        },
      },
      required: ['url'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL that was inspected.',
        },
        tree: {
          description: 'The accessibility tree as the API returns it.',
        },
      },
      required: ['url', 'tree'],
      description: 'The accessibility tree for the page.',
    },
  },
  cloudflare_browser_render: {
    description:
      'Render a web page with Cloudflare Browser Rendering (real headless Chrome, so JavaScript runs). Use markdown for reading a page, links to enumerate its links, and cloudflare_browser_screenshot for a picture of it.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL to render.',
        },
        format: {
          type: 'string',
          description: 'What to return for the page.',
          enum: ['markdown', 'content', 'links', 'scrape', 'json'],
        },
        gotoTimeoutMs: {
          type: 'integer',
          description: 'Navigation timeout in milliseconds.',
        },
        waitForSelector: {
          type: 'string',
          description: 'Wait for this CSS selector before capturing.',
        },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: {
            type: 'string',
            enum: [
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
            ],
          },
        },
      },
      required: ['url', 'format'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL that was rendered.',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'content', 'links', 'scrape', 'json'],
          description: 'The format that was requested.',
        },
        body: {
          description: 'The rendered body: text for text formats, structured data otherwise.',
        },
      },
      required: ['url', 'format', 'body'],
      description: 'The rendered result, plus the url and format that produced it.',
    },
  },
  cloudflare_browser_screenshot: {
    description:
      'Capture a screenshot of a web page with Cloudflare Browser Rendering (real headless Chrome). The image is kept as a durable attachment and returned as an image block: a model that accepts images sees the page and the client can show it; a text-only model is told the image was omitted. Needs an attachment store in the composition.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute URL to capture.',
        },
        type: {
          type: 'string',
          description: 'Image encoding; the configured default (png unless changed) when omitted.',
          enum: ['png', 'jpeg', 'webp'],
        },
        fullPage: {
          type: 'boolean',
          description:
            'Capture the whole scrollable page rather than the viewport; the configured default when omitted.',
        },
        gotoTimeoutMs: {
          type: 'integer',
          description: 'Navigation timeout in milliseconds.',
        },
        waitForSelector: {
          type: 'string',
          description: 'Wait for this CSS selector before capturing.',
        },
        rejectResourceTypes: {
          type: 'array',
          description: 'Resource types to block while the page loads, for example image or script.',
          items: {
            type: 'string',
            enum: [
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
            ],
          },
        },
      },
      required: ['url'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          description: 'The URL that was captured.',
        },
        attachmentId: {
          type: 'string',
          description: 'Durable attachment id of the stored image.',
        },
        mediaType: {
          type: 'string',
          enum: ['image/png', 'image/jpeg', 'image/webp'],
          description: 'Media type of the stored image, verified from its bytes by the store.',
        },
        bytes: {
          type: 'integer',
          description: 'Encoded size in bytes.',
        },
        width: {
          type: 'integer',
          description: 'Width in pixels.',
        },
        height: {
          type: 'integer',
          description: 'Height in pixels.',
        },
      },
      required: ['url', 'attachmentId', 'mediaType', 'bytes', 'width', 'height'],
      description: 'The stored screenshot and the page it shows.',
    },
  },
}

describe('web tool contract', () => {
  const h = makeHarness(toolsModule, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect(h.names().toSorted()).toEqual(Object.keys(CONTRACT).toSorted())
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted description', (name) => {
    expect(h.tool(name).description).toBe(CONTRACT[name]!.description)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted parameter schema', (name) => {
    expect(h.tool(name).parameters).toStrictEqual(CONTRACT[name]!.parameters)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted output schema', (name) => {
    expect(h.tool(name).output.schema).toStrictEqual(CONTRACT[name]!.output)
  })
})

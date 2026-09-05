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
  "cloudflare_browser_accessibility_tree": {
    description: "Fetch the accessibility tree for a web page using Cloudflare Browser Rendering. Returns the roles, names and structure a screen reader would expose, which is what WCAG review needs.",
    parameters: {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "Absolute URL to inspect."
          },
          "gotoTimeoutMs": {
            "type": "integer",
            "description": "Navigation timeout in milliseconds."
          },
          "waitForSelector": {
            "type": "string",
            "description": "Wait for this CSS selector before inspecting."
          },
          "rejectResourceTypes": {
            "type": "array",
            "description": "Resource types to block while the page loads, for example image or script.",
            "items": {
              "type": "string",
              "enum": [
                "document",
                "stylesheet",
                "image",
                "media",
                "font",
                "script",
                "texttrack",
                "xhr",
                "fetch",
                "prefetch",
                "eventsource",
                "websocket",
                "manifest",
                "signedexchange",
                "ping",
                "cspviolationreport",
                "preflight",
                "other"
              ]
            }
          }
        },
        "required": [
          "url"
        ]
      },
    output: {
        "type": "object",
        "description": "The accessibility tree for the page.",
        "additionalProperties": true
      },
  },
  "cloudflare_browser_render": {
    description: "Render a web page with Cloudflare Browser Rendering (real headless Chrome, so JavaScript runs). Use markdown for reading a page, links to enumerate its links, screenshot or pdf for a visual capture.",
    parameters: {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "Absolute URL to render."
          },
          "format": {
            "type": "string",
            "description": "What to return for the page.",
            "enum": [
              "markdown",
              "content",
              "links",
              "screenshot",
              "pdf",
              "scrape",
              "json"
            ]
          },
          "gotoTimeoutMs": {
            "type": "integer",
            "description": "Navigation timeout in milliseconds."
          },
          "waitForSelector": {
            "type": "string",
            "description": "Wait for this CSS selector before capturing."
          },
          "rejectResourceTypes": {
            "type": "array",
            "description": "Resource types to block while the page loads, for example image or script.",
            "items": {
              "type": "string",
              "enum": [
                "document",
                "stylesheet",
                "image",
                "media",
                "font",
                "script",
                "texttrack",
                "xhr",
                "fetch",
                "prefetch",
                "eventsource",
                "websocket",
                "manifest",
                "signedexchange",
                "ping",
                "cspviolationreport",
                "preflight",
                "other"
              ]
            }
          }
        },
        "required": [
          "url",
          "format"
        ]
      },
    output: {
        "type": "object",
        "description": "The rendered result, plus the url and format that produced it.",
        "additionalProperties": true
      },
  },
}

describe('web tool contract', () => {
  const h = makeHarness(toolsModule, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect([...h.tools.keys()].toSorted()).toEqual(Object.keys(CONTRACT).toSorted())
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

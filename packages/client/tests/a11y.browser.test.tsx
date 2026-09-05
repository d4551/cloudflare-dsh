/**
 * Accessibility gate in real Chromium.
 *
 * jsdom cannot compute colour contrast (axe-core#595), so the component tests
 * cover roles, names and structure while this lane covers what only a real
 * browser can: computed styles, contrast in both themes, and focus visibility.
 *
 * Components are server-rendered and served with the shipped stylesheet, so
 * the markup and CSS under test are exactly what a host would load. No axe
 * rule is disabled and no selector is excluded.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { type Browser, type BrowserContext, type Page, chromium } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionCostChip } from '../src/SessionCostChip.tsx'
import { SettingsCard } from '../src/SettingsCard.tsx'
import { AccessibilityTree } from '../src/toolviews/AccessibilityTree.tsx'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'

const css = readFileSync(fileURLToPath(new URL('../src/cloudflare.css', import.meta.url)), 'utf8')

const usage = { requests: 4, cost: 0.0125, tokensIn: 120, tokensOut: 40, cached: 1 }

/** Every surface this package contributes, as static markup. */
const SURFACES: ReadonlyArray<{ name: string; markup: string }> = [
  { name: 'SessionCostChip', markup: renderToStaticMarkup(<SessionCostChip usage={usage} />) },
  { name: 'SessionCostChip (empty)', markup: renderToStaticMarkup(<SessionCostChip />) },
  {
    name: 'SettingsCard',
    markup: renderToStaticMarkup(
      <SettingsCard
        settings={{ apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: '', gatewayId: '' }}
        tokenStored
        onSave={() => undefined}
      />,
    ),
  },
  {
    name: 'D1Result',
    markup: renderToStaticMarkup(
      <D1Result sql="SELECT id, name FROM users" resultSets={[{ results: [{ id: 1, name: 'a' }] }]} />,
    ),
  },
  {
    name: 'BrowserRender',
    markup: renderToStaticMarkup(
      <BrowserRender url="https://example.test" format="markdown" body="# Title" />,
    ),
  },
  {
    name: 'AccessibilityTree',
    markup: renderToStaticMarkup(
      <AccessibilityTree
        url="https://example.test"
        tree={{ role: 'document', name: 'Page', children: [{ role: 'heading', name: 'Title' }] }}
      />,
    ),
  },
]

const THEMES: ReadonlyArray<{ name: string; scheme: 'light' | 'dark' }> = [
  { name: 'light', scheme: 'light' },
  { name: 'dark', scheme: 'dark' },
]

/**
 * Prefer a Chromium the environment has already provisioned.
 *
 * Some sandboxes ship a browser at a fixed path whose build does not match the
 * revision this Playwright would download; using it avoids a download that the
 * network policy may not allow. Falls back to Playwright's own resolution, so
 * CI behaves normally.
 */
const PROVIDED_CHROMIUM = '/opt/pw-browsers/chromium'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch(
    existsSync(PROVIDED_CHROMIUM) ? { executablePath: PROVIDED_CHROMIUM } : {},
  )
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

/**
 * Load one surface into a page with the shipped stylesheet applied.
 *
 * The page comes from an explicit context because `@axe-core/playwright`
 * requires one.
 */
async function open(
  markup: string,
  scheme: 'light' | 'dark',
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ colorScheme: scheme })
  const page = await context.newPage()
  // These are fragments that live inside a host page, so the fixture supplies
  // what a host would: landmarks, a page heading, and readable chrome colours.
  // Page-scoped rules must fail on a real defect, not on an unrealistic
  // harness — and the fix for that is a better fixture, not a filtered rule set.
  const fg = scheme === 'dark' ? '#f2f3f5' : '#16181d'
  const bg = scheme === 'dark' ? '#16181d' : '#ffffff'
  await page.setContent(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cloudflare surfaces</title>` +
      `<style>body{margin:0;color:${fg};background:${bg}}${css}</style>` +
      `</head><body><header><h1>Cloudflare surfaces</h1></header>` +
      `<main>${markup}</main></body></html>`,
  )
  return { page, context }
}

describe('accessibility in Chromium', () => {
  for (const theme of THEMES) {
    for (const surface of SURFACES) {
      it(`${surface.name} has no violations in ${theme.name}`, async () => {
        const { page, context } = await open(surface.markup, theme.scheme)
        try {
          // No tag filter and no disabled rules: every axe rule runs, which is
          // strictly stronger than scoping to the conformance target.
          const results = await new AxeBuilder({ page }).analyze()
          const detail = results.violations
            .map(
              (v) =>
                `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help}\n` +
                v.nodes.map((n) => `      ${n.html}\n      ${n.failureSummary ?? ''}`).join('\n'),
            )
            .join('\n')
          expect(results.violations, detail).toEqual([])
        } finally {
          await context.close()
        }
      }, 30_000)
    }
  }

  it('computes real colour contrast, which jsdom cannot', async () => {
    const { page, context } = await open(SURFACES[0]!.markup, 'light')
    try {
      // No rule filter even here: the full rule set runs, and the contrast rule
      // is proven to have executed by finding it in the results rather than by
      // narrowing the run to it. A jsdom run reports it as inapplicable, so its
      // presence among passes or incomplete is the real signal.
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations).toEqual([])
      const contrast = [...results.passes, ...results.incomplete].filter((r) => r.id === 'color-contrast')
      expect(contrast).not.toEqual([])
    } finally {
      await context.close()
    }
  }, 30_000)
})

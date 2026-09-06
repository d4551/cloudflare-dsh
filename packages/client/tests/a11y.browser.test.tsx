/**
 * Accessibility gate in real Chromium.
 *
 * jsdom cannot compute colour contrast (axe-core#595), so the component tests
 * cover roles, names and structure while this lane covers what only a real
 * browser can: computed styles, text contrast in both colour schemes, and
 * whether a keyboard focus ring is actually drawn. That last one is checked
 * here rather than assumed: axe ships no focus-appearance rule, and the
 * stylesheet's focus block could be deleted with every other gate green.
 *
 * Non-text contrast — borders and the focus ring itself (SC 1.4.11) — is not
 * here, because axe has no rule for it either; the invariants lane computes
 * every pair straight from the stylesheet.
 *
 * Components are server-rendered and served with the shipped stylesheet, so
 * the markup and CSS under test are exactly what a host would load. Each is
 * scanned alone and then all of them together, because a duplicate id or a
 * landmark collision only exists once they share a page. No axe rule is
 * disabled and no selector is excluded.
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

const settings = { apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: '', gatewayId: '' }
const tree = { role: 'document', name: 'Page', children: [{ role: 'heading', name: 'Title' }] }

/**
 * Every state each surface can be rendered into from its props.
 *
 * Not one state per component: the empty, loading and failed chips and the
 * empty result each render copy no other state renders, and a scan of the
 * happy path alone never sees them.
 */
const STATES: ReadonlyArray<{ name: string; element: React.JSX.Element }> = [
  { name: 'SessionCostChip', element: <SessionCostChip usage={usage} /> },
  { name: 'SessionCostChip (empty)', element: <SessionCostChip /> },
  { name: 'SessionCostChip (loading)', element: <SessionCostChip loading /> },
  { name: 'SessionCostChip (failed)', element: <SessionCostChip failed /> },
  {
    name: 'SettingsCard',
    element: <SettingsCard settings={settings} tokenStored onSave={() => undefined} />,
  },
  {
    name: 'SettingsCard (no token stored)',
    element: <SettingsCard settings={settings} tokenStored={false} onSave={() => undefined} />,
  },
  {
    name: 'D1Result',
    element: <D1Result sql="SELECT id, name FROM users" resultSets={[{ results: [{ id: 1, name: 'a' }] }]} />,
  },
  { name: 'D1Result (empty)', element: <D1Result sql="SELECT 1" resultSets={[]} /> },
  {
    name: 'BrowserRender',
    element: <BrowserRender url="https://example.test" body="# Title" />,
  },
  {
    name: 'AccessibilityTree',
    element: <AccessibilityTree url="https://example.test" tree={tree} />,
  },
  {
    name: 'AccessibilityTree (leaf)',
    element: <AccessibilityTree url="https://example.test" tree={{ role: 'document' }} />,
  },
]

/**
 * The client as a host assembles it, in one React tree.
 *
 * One call, not a join of many: `useId` mints ids per render, so rendering
 * each surface separately and concatenating would restart the counter and
 * manufacture id collisions no host would ever produce.
 *
 * The composition is the real one, which is the point of scanning it. The chip
 * and the settings card are singletons — one session header, one settings tab
 * — while a tool view is rendered once per tool call, so each appears twice
 * with identical props. That repetition is what a conversation running the
 * same query twice produces, and it is what caught the tool views being
 * `region` landmarks: two cards, one name, one `landmark-unique` violation.
 */
const ASSEMBLED = renderToStaticMarkup(
  <>
    <SessionCostChip usage={usage} />
    <SettingsCard settings={settings} tokenStored onSave={() => undefined} />
    <D1Result sql="SELECT id FROM users" resultSets={[{ results: [{ id: 1 }] }]} />
    <D1Result sql="SELECT id FROM users" resultSets={[{ results: [{ id: 1 }] }]} />
    <BrowserRender url="https://example.test" body="# Title" />
    <BrowserRender url="https://example.test" body="# Title" />
    <AccessibilityTree url="https://example.test" tree={tree} />
    <AccessibilityTree url="https://example.test" tree={tree} />
  </>,
)

const SURFACES: ReadonlyArray<{ name: string; markup: string }> = [
  ...STATES.map((state) => ({ name: state.name, markup: renderToStaticMarkup(state.element) })),
  { name: 'the assembled client', markup: ASSEMBLED },
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
  browser = await chromium.launch(existsSync(PROVIDED_CHROMIUM) ? { executablePath: PROVIDED_CHROMIUM } : {})
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

/**
 * Tab through `remaining` focus stops, reading the ring drawn on each.
 *
 * Recursive rather than a loop because the steps are genuinely sequential —
 * a focus ring can only be read once focus has moved to the element that
 * carries it, so there is nothing here to run in parallel.
 */
async function walk(page: Page, remaining: number, rings: unknown[] = []): Promise<unknown[]> {
  if (remaining === 0) return rings
  await page.keyboard.press('Tab')
  rings.push(
    await page.evaluate(() => {
      const active = document.activeElement
      if (active === null) return 'nothing focused'
      const computed = getComputedStyle(active)
      return {
        style: computed.outlineStyle,
        width: computed.outlineWidth,
        offset: computed.outlineOffset,
        color: computed.outlineColor,
      }
    }),
  )
  return walk(page, remaining - 1, rings)
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

  /**
   * The focus ring the stylesheet specifies, per scheme.
   *
   * Pinned to the declared treatment rather than to "an outline exists":
   * Chromium draws its own `auto` ring when a page supplies none, so a test
   * that only asks whether something is drawn passes with the stylesheet's
   * focus block deleted — which is exactly the state this lane claimed to
   * cover and did not.
   */
  const FOCUS_RING = {
    light: 'rgb(11, 92, 171)',
    dark: 'rgb(125, 180, 255)',
  } as const

  for (const theme of THEMES) {
    it(`draws the declared focus ring on every focus stop in ${theme.name}`, async () => {
      const { page, context } = await open(ASSEMBLED, theme.scheme)
      try {
        const stops = await page.locator('button, input, [tabindex="0"]').count()
        // Four fields and a submit in the settings card, the chip's toggle,
        // and one focus stop per scrollable tool card — two D1 results and two
        // rendered pages. A drop here means a control stopped being reachable,
        // which is the other half of what this checks.
        expect(stops).toBe(10)
        const rings = await walk(page, stops)
        const expected = {
          style: 'solid',
          width: '2px',
          // The offset is what puts the ring on the page background instead of
          // a button's own fill, which is the pair the invariants lane computes.
          offset: '2px',
          color: FOCUS_RING[theme.scheme],
        }
        expect(rings).toEqual(Array.from({ length: stops }, () => expected))
      } finally {
        await context.close()
      }
    }, 30_000)
  }

  it('leaves nothing for a human to review, not merely nothing failing', async () => {
    // axe reports a third outcome besides pass and fail. `aria-label` on a
    // `<pre>` sat in `incomplete` for as long as this lane read `violations`
    // alone, and the gate stayed green the whole time.
    const { page, context } = await open(ASSEMBLED, 'light')
    try {
      const results = await new AxeBuilder({ page }).analyze()
      const detail = results.incomplete
        .map((r) => `${r.id}: ${r.nodes.map((n) => n.html).join(' | ')}`)
        .join('\n')
      expect(results.incomplete, detail).toEqual([])
    } finally {
      await context.close()
    }
  }, 30_000)

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

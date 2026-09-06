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
import { AxeBuilder } from '@axe-core/playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ASSEMBLED, STATES, THEMES, launch, open } from './surfaces.tsx'

const SURFACES: ReadonlyArray<{ name: string; markup: string }> = [
  ...STATES.map((state) => ({ name: state.name, markup: renderToStaticMarkup(state.element) })),
  { name: 'the assembled client', markup: ASSEMBLED },
]

let browser: Browser

beforeAll(async () => {
  browser = await launch()
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

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
        const { page, context } = await open(browser, surface.markup, { scheme: theme.scheme })
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
      const { page, context } = await open(browser, ASSEMBLED, { scheme: theme.scheme })
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
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'light' })
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
    const { page, context } = await open(browser, SURFACES[0]!.markup, { scheme: 'light' })
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

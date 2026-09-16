/**
 * Accessibility gate in real Chromium.
 *
 * jsdom runs axe's colour-contrast rule but cannot decide it — it comes back
 * `incomplete` there, every time, measured — so the component tests cover
 * roles, names and structure while this lane covers what only a real browser
 * can: computed styles, text contrast in both colour schemes, and whether a
 * keyboard focus ring is actually drawn. That last one is checked here rather
 * than assumed: axe ships no focus-appearance rule, and the stylesheet's focus
 * block could be deleted with every other gate green.
 *
 * Non-text contrast — borders and the focus ring itself (SC 1.4.11) — is not
 * here, because axe has no rule for it either; the invariants lane computes
 * every pair straight from the stylesheet.
 *
 * Components are server-rendered and served with the shipped stylesheet, so the
 * markup and CSS under test are exactly what a host would load. Each is scanned
 * alone and then all of them together, because a duplicate id or a landmark
 * collision only exists once they share a page. No axe rule is disabled and no
 * selector is excluded.
 *
 * The states scanned are the whole shared surface list, so a surface the client
 * package exports is scanned here the day it is added rather than the day
 * somebody extends a list in this file.
 */
import { AxeBuilder } from '@axe-core/playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { browserLane } from './browser.ts'
import { SURFACES } from './fixtures.tsx'
import { ASSEMBLED, OVERFLOWING, THEMES, css, open } from './surfaces.tsx'

/** The lane's browser; every test below opens its own page in a fresh context. */
const lane = browserLane()

/** Every surface, in the markup a server produces, plus the client as a host assembles it. */
const SCANNED: ReadonlyArray<{ name: string; markup: string }> = [
  ...SURFACES.map((surface) => ({
    name: surface.name,
    markup: renderToStaticMarkup(surface.element),
  })),
  { name: 'the assembled client', markup: ASSEMBLED },
]

/**
 * Classes the stylesheet styles that no fixture here renders.
 *
 * Comments are stripped first, so a class named in prose is not mistaken for
 * one that is styled.
 */
function unrendered(sheet: string, markups: readonly string[]): string[] {
  const styled = new Set(
    [...sheet.replaceAll(/\/\*[\s\S]*?\*\//gu, '').matchAll(/\.(cf-[\w-]+)/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    ),
  )
  const rendered = new Set(
    markups
      .flatMap((markup) => [...markup.matchAll(/class="([^"]+)"/gu)])
      .flatMap((match) => (match[1] ?? '').split(/\s+/u)),
  )
  return [...styled].filter((name) => !rendered.has(name)).toSorted()
}

/** The focus ring one focused element draws, as the engine computed it. */
interface Ring {
  readonly style: string
  readonly width: string
  readonly offset: string
  readonly color: string
  /** True when nothing was focused at all, which is its own kind of failure. */
  readonly nothing: boolean
}

/**
 * Tab through `remaining` focus stops, reading the ring drawn on each.
 *
 * Recursive rather than a loop because the steps are genuinely sequential — a
 * focus ring can only be read once focus has moved to the element that carries
 * it, so there is nothing here to run in parallel.
 */
async function walk(page: Page, remaining: number, rings: Ring[] = []): Promise<Ring[]> {
  if (remaining === 0) return rings
  await page.keyboard.press('Tab')
  rings.push(
    await page.evaluate(() => {
      const active = document.activeElement
      if (active === null) return { style: '', width: '', offset: '', color: '', nothing: true }
      const computed = getComputedStyle(active)
      return {
        style: computed.outlineStyle,
        width: computed.outlineWidth,
        offset: computed.outlineOffset,
        color: computed.outlineColor,
        nothing: false,
      }
    }),
  )
  return walk(page, remaining - 1, rings)
}

describe('accessibility in Chromium', () => {
  for (const theme of THEMES) {
    for (const surface of SCANNED) {
      it(`${surface.name} has no violations in ${theme.name}`, async () => {
        const { page, context } = await open(lane.browser, surface.markup, { scheme: theme.scheme })
        onTestFinished(() => context.close())
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
      }, 30_000)
    }
  }

  /**
   * The focus ring the stylesheet specifies, per scheme.
   *
   * Pinned to the declared treatment rather than to "an outline exists":
   * Chromium draws its own `auto` ring when a page supplies none, so a test
   * that only asks whether something is drawn passes with the stylesheet's
   * focus block deleted — which is exactly the state this lane claimed to cover
   * and did not.
   */
  const FOCUS_RING = {
    light: 'rgb(11, 92, 171)',
    dark: 'rgb(125, 180, 255)',
  } as const

  for (const theme of THEMES) {
    it(`draws the declared focus ring on every focus stop in ${theme.name}`, async () => {
      const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: theme.scheme })
      onTestFinished(() => context.close())
      const stops = await page.locator('button, input, [tabindex="0"]').count()
      // Four fields and a submit in the settings card, the chip's toggle, and
      // one focus stop per scrollable tool card — two D1 results, two rendered
      // pages and two unreadable results. A drop here means a control stopped
      // being reachable, which is the other half of what this checks: the
      // unreadable result was a bare `<pre>` that scrolled its own overflow
      // with no way to reach it, and this counted 10 while it was in the tree,
      // because no fixture put it there.
      expect(stops).toBe(12)
      const rings = await walk(page, stops)
      const expected = {
        style: 'solid',
        width: '2px',
        // The offset is what puts the ring on the page background instead of a
        // button's own fill, which is the pair the invariants lane computes.
        offset: '2px',
        color: FOCUS_RING[theme.scheme],
        nothing: false,
      }
      expect(rings).toEqual(Array.from({ length: stops }, () => expected))
    }, 30_000)
  }

  it('leaves nothing for a human to review, not merely nothing failing', async () => {
    // axe reports a third outcome besides pass and fail. `aria-label` on a
    // `<pre>` sat in `incomplete` for as long as this lane read `violations`
    // alone, and the gate stayed green the whole time.
    const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    const results = await new AxeBuilder({ page }).analyze()
    const detail = results.incomplete
      .map((r) => `${r.id}: ${r.nodes.map((n) => n.html).join(' | ')}`)
      .join('\n')
    expect(results.incomplete, detail).toEqual([])
  }, 30_000)

  it('computes real colour contrast, which jsdom cannot', async () => {
    const { page, context } = await open(lane.browser, SCANNED[0]?.markup ?? '', { scheme: 'light' })
    onTestFinished(() => context.close())
    // No rule filter even here: the full rule set runs, and the contrast rule
    // is proven to have executed by finding it among the rules axe decided,
    // rather than by narrowing the run to it.
    //
    // It has to be found among the rules axe *decided*. Under jsdom the rule
    // runs and comes back `incomplete`, so looking for it among passes or
    // incomplete is satisfied there too — that version of this assertion told
    // the two environments apart in its comment and not in its code.
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
    expect(results.passes.map((rule) => rule.id)).toContain('color-contrast')
  }, 30_000)
})

describe('the surfaces this lane scans', () => {
  it('names a styled class the markup never renders', () => {
    expect(
      unrendered('.cf-ghost { color: red }\n.cf-chip { color: red }', ['<p class="cf-chip"></p>']),
    ).toEqual(['cf-ghost'])
  })

  it('reads class names from rules rather than from prose about them', () => {
    expect(
      unrendered('/* .cf-ghost is gone */\n.cf-chip { color: red }', ['<p class="cf-chip"></p>']),
    ).toEqual([])
  })

  it('renders every class the shipped stylesheet styles', () => {
    // A class no fixture renders is styled by a file no lane lays out: axe
    // never scans it, the viewport lane never measures it, the focus walk never
    // reaches it, and every gate stays green. `.cf-toolview__raw` sat there as a
    // scroll container with no focus stop — named by the reflow lane among the
    // containers allowed to scroll, and never once rendered for it.
    expect(unrendered(css, [...SCANNED.map((surface) => surface.markup), OVERFLOWING])).toEqual([])
  })

  it('scans a surface for every state the shared list names', () => {
    // The count is the list's own, not a number written here: what this holds
    // is that the scan reads the list rather than a subset of it.
    expect(SCANNED).toHaveLength(SURFACES.length + 1)
    expect(new Set(SCANNED.map((surface) => surface.name)).size).toBe(SCANNED.length)
  })
})

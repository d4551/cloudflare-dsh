/**
 * How these surfaces behave at a real viewport, in a real browser.
 *
 * The accessibility lane runs at Playwright's default 1280x720 and nothing had
 * ever laid this UI out at any other width. Three WCAG criteria are only
 * observable once you do, and none of them has an axe rule:
 *
 *  - **Reflow (SC 1.4.10)**: at 320 CSS pixels — a 1280px window at 400% zoom,
 *    which is the width the criterion names — content must not need scrolling
 *    in two directions at once. A table or a preformatted block that pushes the
 *    page sideways fails it, and a scroll container is the fix.
 *  - **Target size (SC 2.5.8)**: every control at least 24x24 CSS pixels, or
 *    spaced far enough from its neighbours. The stylesheet declares a minimum;
 *    whether the rendered box honours it is a different question.
 *  - **Text spacing (SC 1.4.12)**: with line height at 1.5x, letter spacing at
 *    0.12em, word spacing at 0.16em and paragraph spacing at 2em, no content
 *    may be lost or clipped. This is the criterion a fixed-height box fails.
 *
 * The lane has grown past those three, and this comment says so rather than
 * describing the file it used to be. It also asks what forced-colours mode
 * leaves, what `hidden` computes to in both directions, how much document a
 * large result produces, and what measure the settings card keeps. Colour
 * resolution — whose scheme these fragments follow, and what an engine below
 * the `light-dark()` floor renders — is the `theme` lane's subject, because a
 * colour is not a viewport.
 */
import type { Page } from 'playwright'
import { describe, expect, it, onTestFinished } from 'vitest'
import { browserLane } from './browser.ts'
import { controls } from './geometry.ts'
import { ASSEMBLED, OVERFLOWING, open } from './surfaces.tsx'

/** The lane's browser; each test opens its own context for a viewport. */
const lane = browserLane()

/**
 * The widths worth laying out.
 *
 * 320 is the reflow criterion's own number. 390 and 430 are the two phone
 * widths in current use; 768 and 1024 are portrait and landscape tablets; 1280
 * and 1920 are the desktop sizes the rest of the suite implicitly assumed.
 */
const VIEWPORTS = [
  { name: '320 (reflow, 400% zoom)', width: 320, height: 568 },
  { name: '390 (phone)', width: 390, height: 844 },
  { name: '430 (large phone)', width: 430, height: 932 },
  { name: '768 (tablet portrait)', width: 768, height: 1024 },
  { name: '1024 (tablet landscape)', width: 1024, height: 768 },
  { name: '1280 (desktop)', width: 1280, height: 800 },
  { name: '1920 (wide desktop)', width: 1920, height: 1080 },
] as const

/**
 * The scroll containers this client ships, named so a new one is deliberate.
 *
 * A wide table and a preformatted body are the two things that legitimately
 * cannot reflow, and the criterion's own remedy for them is a scroll container.
 * Everything else that overflows is a defect.
 *
 * The reflow check no longer excuses anything by this list — it asks the page
 * which elements actually scroll — because a list of selectors drifts from what
 * it describes. This one still named `.cf-toolview__raw` after that class
 * stopped being the container and became the text inside one, so the entry
 * excused the content and left the box it sits in unexcused. The list is kept
 * only to pin which elements scroll, which is a fact worth reviewing when it
 * changes rather than one to discover from a failure elsewhere.
 */
const SCROLL_CONTAINERS = ['figure.cf-d1', 'figure.cf-render', 'figure.cf-toolview']

describe('reflow', () => {
  for (const viewport of VIEWPORTS) {
    it(`lays the assembled client out at ${viewport.name} without scrolling the page sideways`, async () => {
      const { page, context } = await open(lane.browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      onTestFinished(() => context.close())
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    }, 30_000)

    it(`keeps content that cannot reflow inside its own scroller at ${viewport.name}`, async () => {
      // The ordinary fixtures fit any width, so a scroll container that does
      // not work looks exactly like one that does. This markup does not fit.
      const { page, context } = await open(lane.browser, OVERFLOWING, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      onTestFinished(() => context.close())
      // Written inline: this function is serialised into the page, so a helper
      // declared outside it would not exist by the time it runs.
      const result = await page.evaluate(() => {
        const root = document.documentElement
        const scrolling = new Set<Element>()
        for (const node of document.querySelectorAll('main *')) {
          const style = getComputedStyle(node)
          if (/^(?:auto|scroll)$/u.test(style.overflowX) || /^(?:auto|scroll)$/u.test(style.overflowY)) {
            scrolling.add(node)
          }
        }
        const offenders: string[] = []
        for (const node of document.querySelectorAll<HTMLElement>('main *')) {
          let inside = false
          // A proper ancestor, not the node itself: a scroll container that
          // does not fit the viewport is a defect like any other, and excusing
          // it by its own overflow is how one would hide.
          for (let at = node.parentElement; at !== null; at = at.parentElement) {
            if (scrolling.has(at)) {
              inside = true
              break
            }
          }
          if (inside) continue
          if (node.getBoundingClientRect().right > root.clientWidth + 1) {
            offenders.push(`${node.tagName.toLowerCase()}.${node.className}`)
          }
        }
        return {
          pageOverflow: root.scrollWidth - root.clientWidth,
          offenders,
          containers: [...scrolling].map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
        }
      })
      expect(result.offenders).toEqual([])
      expect(result.pageOverflow).toBeLessThanOrEqual(0)
      // The list above is a claim about this markup, checked against it here
      // rather than remembered.
      expect([...new Set(result.containers)].toSorted()).toEqual([...SCROLL_CONTAINERS].toSorted())
    }, 30_000)
  }
})

describe('forced colours', () => {
  // Windows high-contrast mode replaces every colour the page chose. A
  // component that opts out of that, or that draws a boundary the mode cannot
  // repaint, becomes unreadable for the people who rely on it — and no other
  // lane here runs with the mode on.
  it('opts nothing out of the system palette', async () => {
    const { page, context } = await open(lane.browser, ASSEMBLED, {
      scheme: 'light',
      forcedColors: 'active',
    })
    onTestFinished(() => context.close())
    const optedOut = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((node) => getComputedStyle(node).forcedColorAdjust === 'none')
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
    )
    expect(optedOut).toEqual([])
  }, 30_000)

  it('keeps a field and a table cell bounded by a border the mode can repaint', async () => {
    const { page, context } = await open(lane.browser, ASSEMBLED, {
      scheme: 'light',
      forcedColors: 'active',
    })
    onTestFinished(() => context.close())
    // Written without a helper: this function is serialised into the page, so
    // anything it calls has to be inside it.
    const widths = await page.evaluate(() => {
      const field = document.querySelector('.cf-field input')
      const cell = document.querySelector('.cf-d1 td')
      return {
        field: field === null ? 0 : Number.parseFloat(getComputedStyle(field).borderTopWidth),
        cell: cell === null ? 0 : Number.parseFloat(getComputedStyle(cell).borderTopWidth),
      }
    })
    // A background alone disappears in this mode; a border does not.
    expect(widths.field).toBeGreaterThanOrEqual(1)
    expect(widths.cell).toBeGreaterThanOrEqual(1)
  }, 30_000)
})

describe('the size of what is rendered', () => {
  it('keeps a large result from becoming a large document', async () => {
    // The row cap is asserted in jsdom against the rendered rows. This is the
    // claim that matters for a conversation card: whatever the query returned,
    // the document a browser has to lay out stays bounded.
    const { page, context } = await open(lane.browser, OVERFLOWING, { scheme: 'light' })
    onTestFinished(() => context.close())
    const nodes = await page.evaluate(() => document.querySelectorAll('main *').length)
    expect(nodes).toBeLessThan(400)
  }, 30_000)
})

describe('measure', () => {
  // A fragment inherits its host's width, and at a desktop width that meant a
  // metre-wide text field and prose running to hundreds of characters a line.
  // The cap only ever narrows: below it the card is still fluid.
  it.each([
    ['1280 (desktop)', 1280],
    ['1920 (wide desktop)', 1920],
  ])(
    'keeps the settings card to a readable measure at %s',
    async (_label, width) => {
      const { page, context } = await open(lane.browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width, height: 900 },
      })
      onTestFinished(() => context.close())
      const widths = await page.evaluate(() => ({
        card: Math.round(document.querySelector('.cf-settings')?.getBoundingClientRect().width ?? 0),
        field: Math.round(document.querySelector('.cf-field input')?.getBoundingClientRect().width ?? 0),
      }))
      expect(widths.card).toBeLessThan(800)
      expect(widths.field).toBeLessThan(600)
    },
    30_000,
  )

  it('still fills a narrow viewport, so the cap never becomes a fixed width', async () => {
    const { page, context } = await open(lane.browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 390, height: 900 },
    })
    onTestFinished(() => context.close())
    const measured = await page.evaluate(() => ({
      card: Math.round(document.querySelector('.cf-settings')?.getBoundingClientRect().width ?? 0),
      field: Math.round(document.querySelector('.cf-field input')?.getBoundingClientRect().width ?? 0),
    }))
    // The field fills the card's content box — its width less 1rem of padding
    // on each side. Stated as the relationship rather than as a number, which
    // would depend on how wide this browser draws a scrollbar.
    expect(measured.field).toBe(measured.card - 32)
  }, 30_000)
})

describe('what `hidden` does', () => {
  // jsdom applies no CSS, so a test there can only ask whether the attribute is
  // set. Whether the element is actually gone is a computed style, and a class
  // that sets `display` outranks the user agent rule that would have hidden it.
  it('takes the collapsed detail out of the layout, not just out of the markup', async () => {
    const { page, context } = await open(lane.browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 1280, height: 800 },
    })
    onTestFinished(() => context.close())
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[hidden]')]
        .filter((node) => getComputedStyle(node).display !== 'none')
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
    )
    expect(shown).toEqual([])
  }, 30_000)

  it('puts the detail back in the layout once it is no longer hidden', async () => {
    // The other half: a rule that hid it unconditionally would pass the check
    // above and break the feature.
    const { page, context } = await open(lane.browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 1280, height: 800 },
    })
    onTestFinished(() => context.close())
    const display = await page.evaluate(() => {
      const detail = document.querySelector<HTMLElement>('.cf-chip__detail')
      detail?.removeAttribute('hidden')
      return detail === null ? 'missing' : getComputedStyle(detail).display
    })
    expect(display).toBe('grid')
  }, 30_000)
})

/**
 * The two pointers, and the floor each one earns.
 *
 * 24 is the conformance minimum SC 2.5.8 sets for any pointer. A finger is not
 * any pointer — Apple's HIG asks for 44pt and Material for 48dp — so the
 * stylesheet gives a coarse pointer 44, and this is what holds it. Nothing did:
 * every lane ran with a mouse, `hasTouch` is the only context option that makes
 * `(pointer: coarse)` match, and the whole media block could have been deleted
 * with every gate green under a page claiming it measured.
 */
const POINTERS = [
  { name: 'a fine pointer', touch: false, floor: 24 },
  { name: 'a coarse pointer', touch: true, floor: 44 },
] as const

describe('target size', () => {
  for (const pointer of POINTERS) {
    for (const viewport of VIEWPORTS) {
      it(`gives every control at least ${pointer.floor}px with ${pointer.name} at ${viewport.name}`, async () => {
        const { page, context } = await open(lane.browser, ASSEMBLED, {
          scheme: 'light',
          viewport: { width: viewport.width, height: viewport.height },
          touch: pointer.touch,
        })
        onTestFinished(() => context.close())
        // The emulation is asserted, not trusted: a context option that
        // stopped flipping the media feature would silently retest a mouse
        // under a name promising a finger.
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(pointer.touch)
        const measured = await controls(page, pointer.floor)
        // How many controls were measured, not just that none was too small:
        // this assertion holds for an empty page, and every control in the
        // assembled client is a focus stop, which is the same twelve the
        // keyboard walk counts.
        expect(measured).toHaveLength(12)
        expect(measured.filter((box) => box.under)).toEqual([])
      }, 30_000)
    }
  }
})

/**
 * The overrides SC 1.4.12 names, spelled as the criterion spells them.
 *
 * Applied to the elements themselves rather than through a stylesheet, because
 * a user stylesheet has to win a specificity contest to take effect — which
 * would leave this lane measuring the cascade instead of the criterion. The
 * computed result is the same, and the overrides are read back from the page
 * afterwards: a declaration that never applied is invisible in a count of
 * clipped elements.
 */
const SPACING = ['line-height:1.5', 'letter-spacing:0.12em', 'word-spacing:0.16em']

/** The paragraph spacing the criterion names, on the paragraphs alone. */
const PARAGRAPH = 'margin-block-end:2em'

/** Apply the criterion's overrides to every element under `main`. */
async function applyTextSpacing(page: Page): Promise<void> {
  await page.evaluate(
    (overrides) => {
      const apply = (node: HTMLElement, declaration: string): void => {
        const separator = declaration.indexOf(':')
        node.style.setProperty(declaration.slice(0, separator), declaration.slice(separator + 1))
      }
      for (const node of document.querySelectorAll<HTMLElement>('main *')) {
        for (const declaration of overrides.spacing) apply(node, declaration)
        if (node.tagName === 'P') apply(node, overrides.paragraph)
      }
    },
    { spacing: SPACING, paragraph: PARAGRAPH },
  )
}

describe('text spacing', () => {
  for (const viewport of VIEWPORTS) {
    it(`loses no content under the text-spacing overrides at ${viewport.name}`, async () => {
      const { page, context } = await open(lane.browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      onTestFinished(() => context.close())
      await applyTextSpacing(page)
      // Read back as ratios against the face's own size, which is what the
      // criterion states and what a pinned pixel value would only approximate.
      const applied = await page.evaluate(() => {
        const figure = document.querySelector('.cf-chip__figure')
        const hint = document.querySelector('.cf-hint')
        if (figure === null || hint === null) return null
        const style = getComputedStyle(figure)
        const size = Number.parseFloat(style.fontSize)
        const paragraph = getComputedStyle(hint)
        return {
          lineHeight: Number.parseFloat(style.lineHeight) / size,
          letterSpacing: Number.parseFloat(style.letterSpacing) / size,
          wordSpacing: Number.parseFloat(style.wordSpacing) / size,
          paragraph: Number.parseFloat(paragraph.marginBlockEnd) / Number.parseFloat(paragraph.fontSize),
        }
      })
      expect(applied).toEqual({
        lineHeight: 1.5,
        letterSpacing: 0.12,
        wordSpacing: 0.16,
        paragraph: 2,
      })
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main *')]
          .filter((node) => {
            const style = getComputedStyle(node)
            // Only a box that hides its own overflow can clip; a scroller
            // reaches its content, and a visible overflow spills but keeps it.
            if (style.overflowY !== 'hidden' && style.overflowX !== 'hidden') return false
            return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
          })
          .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
      )
      expect(clipped).toEqual([])
    }, 30_000)
  }
})

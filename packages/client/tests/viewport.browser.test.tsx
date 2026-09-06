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
 */
import type { Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ASSEMBLED, OVERFLOWING, launch, open } from './surfaces.tsx'

let browser: Browser

beforeAll(async () => {
  browser = await launch()
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

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
 * The elements allowed to scroll sideways.
 *
 * A wide table and a preformatted body are the two things that legitimately
 * cannot reflow, and the criterion's own remedy for them is a scroll
 * container. Everything else that overflows is a defect.
 */
const SCROLLERS = ['.cf-d1', '.cf-render', '.cf-toolview__raw']

describe('reflow', () => {
  for (const viewport of VIEWPORTS) {
    it(`lays the assembled client out at ${viewport.name} without scrolling the page sideways`, async () => {
      const { page, context } = await open(browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      try {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )
        expect(overflow).toBeLessThanOrEqual(0)
      } finally {
        await context.close()
      }
    }, 30_000)

    it(`keeps content that cannot reflow inside its own scroller at ${viewport.name}`, async () => {
      // The ordinary fixtures fit any width, so a scroll container that does
      // not work looks exactly like one that does. This markup does not fit.
      const { page, context } = await open(browser, OVERFLOWING, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      try {
        const result = await page.evaluate((scrollers: string[]) => {
          const root = document.documentElement
          const offenders: string[] = []
          for (const node of document.querySelectorAll<HTMLElement>('main *')) {
            const inScroller = scrollers.some((selector) => node.closest(selector) !== null)
            if (inScroller) continue
            if (node.getBoundingClientRect().right > root.clientWidth + 1) {
              offenders.push(`${node.tagName.toLowerCase()}.${node.className}`)
            }
          }
          return { pageOverflow: root.scrollWidth - root.clientWidth, offenders }
        }, SCROLLERS)
        expect(result.offenders).toEqual([])
        expect(result.pageOverflow).toBeLessThanOrEqual(0)
      } finally {
        await context.close()
      }
    }, 30_000)
  }
})

describe('colour scheme', () => {
  /** The dark foreground token, as the stylesheet declares it. */
  const DARK_FG = 'rgb(242, 243, 245)'

  it('follows the operating system preference, as it always did', async () => {
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'dark' })
    try {
      const colour = await page.evaluate(
        () => getComputedStyle(document.querySelector('.cf-settings') as Element).color,
      )
      expect(colour).toBe(DARK_FG)
    } finally {
      await context.close()
    }
  }, 30_000)

  it('lets a host token win over both schemes, which is the extension point', async () => {
    // `color-scheme: light dark` on these roots means an ancestor's scheme is
    // not inherited — as with the media query this replaces. A host themes
    // these surfaces through the `--dsh-*` tokens instead, and this is the test
    // that says so.
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'dark' })
    try {
      const colour = await page.evaluate(() => {
        const main = document.querySelector('main') as HTMLElement
        main.style.setProperty('--dsh-fg', 'rgb(1, 2, 3)')
        return getComputedStyle(document.querySelector('.cf-settings') as Element).color
      })
      expect(colour).toBe('rgb(1, 2, 3)')
    } finally {
      await context.close()
    }
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
      const { page, context } = await open(browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width, height: 900 },
      })
      try {
        const widths = await page.evaluate(() => ({
          card: Math.round(document.querySelector('.cf-settings')?.getBoundingClientRect().width ?? 0),
          field: Math.round(document.querySelector('.cf-field input')?.getBoundingClientRect().width ?? 0),
        }))
        expect(widths.card).toBeLessThan(800)
        expect(widths.field).toBeLessThan(600)
      } finally {
        await context.close()
      }
    },
    30_000,
  )

  it('still fills a narrow viewport, so the cap never becomes a fixed width', async () => {
    const { page, context } = await open(browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 390, height: 900 },
    })
    try {
      const measured = await page.evaluate(() => ({
        card: Math.round(document.querySelector('.cf-settings')?.getBoundingClientRect().width ?? 0),
        field: Math.round(document.querySelector('.cf-field input')?.getBoundingClientRect().width ?? 0),
      }))
      // The field fills the card's content box — its width less 1rem of padding
      // on each side. Stated as the relationship rather than as a number, which
      // would depend on how wide this browser draws a scrollbar.
      expect(measured.field).toBe(measured.card - 32)
    } finally {
      await context.close()
    }
  }, 30_000)
})

describe('what `hidden` does', () => {
  // jsdom applies no CSS, so a test there can only ask whether the attribute is
  // set. Whether the element is actually gone is a computed style, and a class
  // that sets `display` outranks the user agent rule that would have hidden it.
  it('takes the collapsed detail out of the layout, not just out of the markup', async () => {
    const { page, context } = await open(browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 1280, height: 800 },
    })
    try {
      const shown = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[hidden]')]
          .filter((node) => getComputedStyle(node).display !== 'none')
          .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
      )
      expect(shown).toEqual([])
    } finally {
      await context.close()
    }
  }, 30_000)

  it('puts the detail back in the layout once it is no longer hidden', async () => {
    // The other half: a rule that hid it unconditionally would pass the check
    // above and break the feature.
    const { page, context } = await open(browser, ASSEMBLED, {
      scheme: 'light',
      viewport: { width: 1280, height: 800 },
    })
    try {
      const display = await page.evaluate(() => {
        const detail = document.querySelector<HTMLElement>('.cf-chip__detail')
        detail?.removeAttribute('hidden')
        return detail === null ? 'missing' : getComputedStyle(detail).display
      })
      expect(display).toBe('grid')
    } finally {
      await context.close()
    }
  }, 30_000)
})

describe('target size', () => {
  for (const viewport of VIEWPORTS) {
    it(`gives every control at least 24x24 CSS pixels at ${viewport.name}`, async () => {
      const { page, context } = await open(browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      try {
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')]
            .map((node) => ({
              what: `${node.tagName.toLowerCase()}${node.getAttribute('name') === null ? '' : `[${node.getAttribute('name')}]`}`,
              width: Math.round(node.getBoundingClientRect().width),
              height: Math.round(node.getBoundingClientRect().height),
            }))
            .filter((box) => box.width < 24 || box.height < 24),
        )
        expect(small).toEqual([])
      } finally {
        await context.close()
      }
    }, 30_000)
  }
})

describe('text spacing', () => {
  /** The overrides SC 1.4.12 names, applied as a user stylesheet would. */
  const SPACING = [
    '*{line-height:1.5 !important;',
    'letter-spacing:0.12em !important;',
    'word-spacing:0.16em !important}',
    'p{margin-block-end:2em !important}',
  ].join('')

  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3], VIEWPORTS[5]]) {
    it(`loses no content under the text-spacing overrides at ${viewport.name}`, async () => {
      const { page, context } = await open(browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      try {
        await page.addStyleTag({ content: SPACING })
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
      } finally {
        await context.close()
      }
    }, 30_000)
  }
})

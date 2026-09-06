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
import { ASSEMBLED, type HostScheme, OVERFLOWING, css, launch, open } from './surfaces.tsx'

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

describe('forced colours', () => {
  // Windows high-contrast mode replaces every colour the page chose. A
  // component that opts out of that, or that draws a boundary the mode cannot
  // repaint, becomes unreadable for the people who rely on it — and no other
  // lane here runs with the mode on.
  it('opts nothing out of the system palette', async () => {
    const context = await browser.newContext({ forcedColors: 'active' })
    const page = await context.newPage()
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>` +
          `<style>${css}</style></head><body><main>${ASSEMBLED}</main></body></html>`,
      )
      const optedOut = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main *')]
          .filter((node) => getComputedStyle(node).forcedColorAdjust === 'none')
          .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
      )
      expect(optedOut).toEqual([])
    } finally {
      await context.close()
    }
  }, 30_000)

  it('keeps a field and a table cell bounded by a border the mode can repaint', async () => {
    const context = await browser.newContext({ forcedColors: 'active' })
    const page = await context.newPage()
    try {
      await page.setContent(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>` +
          `<style>${css}</style></head><body><main>${ASSEMBLED}</main></body></html>`,
      )
      // Written without a helper: this function is serialised into the page,
      // so anything it calls has to be inside it.
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
    } finally {
      await context.close()
    }
  }, 30_000)
})

describe('the size of what is rendered', () => {
  it('keeps a large result from becoming a large document', async () => {
    // The row cap is asserted in jsdom against the rendered rows. This is the
    // claim that matters for a conversation card: whatever the query returned,
    // the document a browser has to lay out stays bounded.
    const { page, context } = await open(browser, OVERFLOWING, { scheme: 'light' })
    try {
      const nodes = await page.evaluate(() => document.querySelectorAll('main *').length)
      expect(nodes).toBeLessThan(400)
    } finally {
      await context.close()
    }
  }, 30_000)
})

describe('colour scheme', () => {
  /** The foreground tokens, as the stylesheet declares them. */
  const FG = { light: 'rgb(22, 24, 29)', dark: 'rgb(242, 243, 245)' } as const

  /**
   * Whose choice these fragments follow, asked in every combination.
   *
   * `host` is what the page declares; `os` is what the reader's system prefers.
   * A page declaring `light dark` is deferring, so the system decides; a page
   * naming one has chosen, so the page decides. `color-scheme` inherits, and
   * `light-dark()` reads the used scheme, so a fragment that declares nothing
   * gets all six for free.
   *
   * The two crossed rows are the ones that were wrong. While these roots
   * declared a `color-scheme` of their own, the fragment answered the system
   * while the page answered itself: a dark card on a white document, and a
   * light one on a black document, in a host that had done nothing unusual.
   * Every fixture agreed with the system, so no lane ever disagreed with it.
   */
  const RESOLVED: ReadonlyArray<{
    host: HostScheme
    os: 'light' | 'dark'
    used: 'light' | 'dark'
  }> = [
    { host: 'light dark', os: 'light', used: 'light' },
    { host: 'light dark', os: 'dark', used: 'dark' },
    { host: 'light', os: 'light', used: 'light' },
    { host: 'light', os: 'dark', used: 'light' },
    { host: 'dark', os: 'light', used: 'dark' },
    { host: 'dark', os: 'dark', used: 'dark' },
  ]

  it.each(RESOLVED)(
    'resolves $used where the host declares "$host" and the system prefers $os',
    async ({ host, os, used }) => {
      const { page, context } = await open(browser, ASSEMBLED, { scheme: os, hostScheme: host })
      try {
        const read = await page.evaluate(() => {
          const card = document.querySelector('.cf-settings') as Element
          return {
            colour: getComputedStyle(card).color,
            card: getComputedStyle(card).backgroundColor,
            // The failure worth naming is not a wrong token but a fragment at
            // odds with the page beneath it, so the page is read too.
            page: getComputedStyle(document.body).backgroundColor,
          }
        })
        expect(read.colour).toBe(FG[used])
        expect(read.card).toBe(read.page)
      } finally {
        await context.close()
      }
    },
    30_000,
  )

  it('lets a host token win over both schemes, which is the extension point', async () => {
    // A scheme is the coarse control and the `--dsh-*` tokens are the fine one:
    // a host with its own palette sets those, and they win in either scheme.
    // This is the test that says so.
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

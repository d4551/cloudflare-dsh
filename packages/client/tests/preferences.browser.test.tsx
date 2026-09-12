/**
 * What the reader preferences leave, in a real browser.
 *
 * The viewport lane lays the surfaces out at many widths; this one holds the
 * preferences a reader sets. Four of them have no axe rule and no jsdom
 * answer, because each is a computed style or a media feature only a real
 * engine resolves: resize text (SC 1.4.4), reduced motion, reduced
 * transparency, and increased contrast. Every emulation is asserted against
 * its own media feature, on the same terms as the pointer emulation the
 * target-size lane performs.
 */
import type { Browser, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest'
import { ASSEMBLED, launch, open } from './surfaces.tsx'

let browser: Browser

beforeAll(async () => {
  browser = await launch()
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

/** The declared foreground token, as the stylesheet declares it in the light scheme. */
const FG_LIGHT = 'rgb(22, 24, 29)'

/** The declared accent button pair, as the stylesheet declares it. */
const ACCENT = { background: 'rgb(11, 92, 171)', text: 'rgb(255, 255, 255)' } as const

/** What the page looks like once the root font size is doubled. */
interface Resized {
  /** The chip figure's font size before the resize, in CSS pixels. */
  readonly before: string
  /** The same face's font size after the resize, in CSS pixels. */
  readonly after: string
  /** Every box that hides its own overflow and has lost content to it. */
  readonly clipped: string[]
  /** Every control that can no longer be reached where it sits. */
  readonly unhittable: string[]
}

/**
 * Double the root font size and measure what the page does.
 *
 * The chip figure is the smallest face the package ships (0.8125rem), so it is
 * the one a px-sized face would leave behind: every larger face could double
 * while it stayed fixed.
 *
 * SC 1.4.4 asks for no loss of content or functionality, not for a page that
 * never scrolls: at 320 pixels with doubled text the document may scroll
 * sideways, and the loss to measure is content clipped out of a box that
 * hides its own overflow — a scroller reaches its content, and a visible
 * overflow spills but keeps it — and a control that can no longer be hit at
 * its centre, which is the same minimum test the focus lane applies.
 */
async function textAt200Percent(page: Page): Promise<Resized> {
  const figureSize = () =>
    page.evaluate(() => getComputedStyle(document.querySelector('.cf-chip__figure') as Element).fontSize)
  const before = await figureSize()
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  const after = await figureSize()
  const laidOut = await page.evaluate(() => {
    const describe = (node: Element): string => `${node.tagName.toLowerCase()}.${node.className}`
    const clipped = [...document.querySelectorAll<HTMLElement>('main *')]
      .filter((node) => {
        const style = getComputedStyle(node)
        if (style.overflowY !== 'hidden' && style.overflowX !== 'hidden') return false
        return node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
      })
      .map(describe)
    const unhittable = [...document.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')]
      .filter((node) => {
        const box = node.getBoundingClientRect()
        const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return centre === null || (centre !== node && !node.contains(centre))
      })
      .map(describe)
    return { clipped, unhittable }
  })
  return { before, after, clipped: laidOut.clipped, unhittable: laidOut.unhittable }
}

describe('resize text', () => {
  // SC 1.4.4 is about the reader's setting, not one width: the desktop size
  // the other lanes assume, and the 320-pixel width the reflow criterion
  // names, which is also a 1280-pixel window at 400% zoom.
  const WIDTHS = [
    { name: '1280 (desktop)', width: 1280, height: 800 },
    { name: '320 (reflow, 400% zoom)', width: 320, height: 568 },
  ] as const

  for (const viewport of WIDTHS) {
    it(`doubles every face and loses no content or function at 200% text at ${viewport.name}`, async () => {
      const { page, context } = await open(browser, ASSEMBLED, {
        scheme: 'light',
        viewport: { width: viewport.width, height: viewport.height },
      })
      onTestFinished(() => context.close())
      const resized = await textAt200Percent(page)
      expect(Number.parseFloat(resized.after)).toBe(Number.parseFloat(resized.before) * 2)
      expect(resized.clipped).toEqual([])
      expect(resized.unhittable).toEqual([])
    }, 30_000)
  }
})

describe('reduced motion', () => {
  // The stylesheet animates nothing, which the invariants lane enforces on the
  // file's text; this measures what a reader who asks the system for reduced
  // motion is actually given.
  it('runs no transition and no animation under prefers-reduced-motion: reduce', async () => {
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    const moving = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main *')]
        .filter((node) => {
          const style = getComputedStyle(node)
          return (
            style.transitionDuration.split(', ').some((value) => Number.parseFloat(value) > 0) ||
            style.animationName !== 'none' ||
            style.animationDuration.split(', ').some((value) => Number.parseFloat(value) > 0)
          )
        })
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`),
    )
    expect(moving).toEqual([])
  }, 30_000)
})

describe('reduced transparency', () => {
  // Every background is a solid token, so a reader who asks for reduced
  // transparency gets exactly the same surfaces; a translucent material would
  // put text over whatever the host page keeps behind it. Playwright's
  // emulateMedia carries no reduced-transparency key, so the preference is set
  // the way the browser itself receives it: the CDP media-emulation feature
  // the method wraps.
  it('keeps every background fully opaque under prefers-reduced-transparency: reduce', async () => {
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    })
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches),
    ).toBe(true)
    const translucent = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('main *')]
        .map((node) => ({ node, background: getComputedStyle(node).backgroundColor }))
        // Chromium serialises a fully transparent background as
        // `rgba(0, 0, 0, 0)` and anything with alpha below one as `rgba(...)`;
        // only the second kind is a translucent surface.
        .filter(({ background }) => background.startsWith('rgba(') && background !== 'rgba(0, 0, 0, 0)')
        .map(({ node, background }) => `${node.tagName.toLowerCase()}.${node.className}: ${background}`),
    )
    expect(translucent).toEqual([])
  }, 30_000)
})

describe('increased contrast', () => {
  // The tokens already meet their ratios in both schemes, which the invariants
  // lane computes from the file, so the design answers `prefers-contrast:
  // more` by standing still; this pins that standing still.
  it('changes no declared colour under prefers-contrast: more', async () => {
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    await page.emulateMedia({ contrast: 'more' })
    expect(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches)).toBe(true)
    const read = await page.evaluate(() => ({
      card: getComputedStyle(document.querySelector('.cf-settings') as Element).color,
      buttonBackground: getComputedStyle(document.querySelector('.cf-settings button') as Element)
        .backgroundColor,
      buttonColour: getComputedStyle(document.querySelector('.cf-settings button') as Element).color,
    }))
    expect(read).toEqual({ card: FG_LIGHT, buttonBackground: ACCENT.background, buttonColour: ACCENT.text })
  }, 30_000)
})

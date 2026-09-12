/**
 * Focus is never entirely hidden (SC 2.4.11), in a real browser.
 *
 * The accessibility lane walks every focus stop and reads the ring each one
 * draws; nothing asks whether the focused control is actually visible where it
 * lands. These surfaces ship a sticky caption that sits on top of a scrolling
 * card's content, which is exactly the kind of overlay the criterion names —
 * a focused element scrolled beneath it would be focused and unseen at once,
 * with every other lane green.
 *
 * The check is the criterion's own minimum test: after each Tab, the point at
 * the centre of the focused element must hit that element or one of its
 * descendants. A centre hit is what "not entirely hidden" means; partial
 * coverage by an overlay is allowed at this level. The context is registered
 * for cleanup when the test finishes, so a failing assertion cannot leak it
 * into the next test.
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

/**
 * One focus stop whose centre is covered, described so a failure names it.
 *
 * `stop` is the position in tab order, which is how a keyboard user reached
 * it; `problem` is what the centre point hit instead.
 */
interface CoveredStop {
  readonly stop: number
  readonly problem: string
}

/**
 * Tab through `remaining` focus stops, recording any whose centre is covered.
 *
 * Recursive rather than a loop because the steps are genuinely sequential —
 * a focus can only be read once focus has moved to the element that carries
 * it, so there is nothing here to run in parallel.
 */
async function walk(
  page: Page,
  remaining: number,
  at: number,
  covered: CoveredStop[],
): Promise<CoveredStop[]> {
  if (remaining === 0) return covered
  await page.keyboard.press('Tab')
  const problem = await page.evaluate(() => {
    const active = document.activeElement
    if (active === null || active === document.body) return 'nothing focused'
    const box = active.getBoundingClientRect()
    const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    // The element itself, or a descendant filling it: a scroll container's
    // centre is the content it scrolls, which is the container seen through.
    return centre !== null && (centre === active || active.contains(centre))
      ? ''
      : `centre covered by ${centre === null ? 'nothing (off-viewport)' : `${centre.tagName.toLowerCase()}.${centre.className}`}`
  })
  const next = problem === '' ? covered : [...covered, { stop: at, problem }]
  return walk(page, remaining - 1, at + 1, next)
}

describe('focus not obscured', () => {
  it('keeps every focus stop visible at its centre after it is tabbed to', async () => {
    const { page, context } = await open(browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    // The same twelve stops the accessibility lane's keyboard walk counts:
    // four fields and a submit in the settings card, the chip's toggle, and
    // one focus stop per scrollable tool card.
    const stops = await page.locator('button, input, [tabindex="0"]').count()
    expect(stops).toBe(12)
    expect(await walk(page, stops, 1, [])).toEqual([])
  }, 30_000)
})

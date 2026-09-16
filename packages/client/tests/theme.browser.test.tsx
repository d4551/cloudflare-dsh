/**
 * Whose colour scheme these fragments follow, and what an engine below the
 * floor renders.
 *
 * A colour is not a viewport, and these questions are only answerable once a
 * real engine has resolved `light-dark()` against a used scheme: what a page
 * declaring `light dark` does when the system disagrees, what a page that names
 * one scheme does, whether a host token can win over both, and what an engine
 * that cannot parse the function is left with. Every one of them is a computed
 * colour, so none of them belongs in jsdom.
 *
 * The lane that lays the client out at many widths lives in `viewport`; this one
 * holds the palette, and the accessibility lane holds the contrast axe can
 * compute from it.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { browserLane } from './browser.ts'
import { ASSEMBLED, type HostScheme, css, open } from './surfaces.tsx'

/** The lane's browser; each test opens its own context for a scheme. */
const lane = browserLane()

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
 * The two crossed rows are the ones that were wrong. While these roots declared
 * a `color-scheme` of their own, the fragment answered the system while the page
 * answered itself: a dark card on a white document, and a light one on a black
 * document, in a host that had done nothing unusual. Every fixture agreed with
 * the system, so no lane ever disagreed with it.
 */
const RESOLVED: ReadonlyArray<{
  readonly name: string
  readonly host: HostScheme
  readonly os: 'light' | 'dark'
  readonly used: 'light' | 'dark'
}> = [
  { name: 'a deferring page on a light system', host: 'light dark', os: 'light', used: 'light' },
  { name: 'a deferring page on a dark system', host: 'light dark', os: 'dark', used: 'dark' },
  { name: 'a light page on a light system', host: 'light', os: 'light', used: 'light' },
  { name: 'a light page on a dark system', host: 'light', os: 'dark', used: 'light' },
  { name: 'a dark page on a light system', host: 'dark', os: 'light', used: 'dark' },
  { name: 'a dark page on a dark system', host: 'dark', os: 'dark', used: 'dark' },
]

describe('colour scheme', () => {
  for (const { name, host, os, used } of RESOLVED) {
    it(`resolves ${used} with ${name}`, async () => {
      const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: os, hostScheme: host })
      onTestFinished(() => context.close())
      const read = await page.evaluate(() => {
        const card = document.querySelector<HTMLElement>('.cf-settings')
        if (card === null) return null
        return {
          colour: getComputedStyle(card).color,
          card: getComputedStyle(card).backgroundColor,
          // The failure worth naming is not a wrong token but a fragment at
          // odds with the page beneath it, so the page is read too.
          page: getComputedStyle(document.body).backgroundColor,
        }
      })
      expect(read).not.toBeNull()
      expect(read?.colour).toBe(FG[used])
      expect(read?.card).toBe(read?.page)
    }, 30_000)
  }

  it('lets a host token win over both schemes, which is the extension point', async () => {
    // A scheme is the coarse control and the `--dsh-*` tokens are the fine one:
    // a host with its own palette sets those, and they win in either scheme.
    // This is the test that says so.
    const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: 'dark' })
    onTestFinished(() => context.close())
    const colour = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main')
      const card = document.querySelector<HTMLElement>('.cf-settings')
      if (main === null || card === null) return null
      main.style.setProperty('--dsh-fg', 'rgb(1, 2, 3)')
      return getComputedStyle(card).color
    })
    expect(colour).toBe('rgb(1, 2, 3)')
  }, 30_000)
})

describe('without light-dark()', () => {
  /**
   * The stylesheet as an engine below the floor parses it.
   *
   * Every colour here is a `light-dark()` pair, which needs Chrome and Edge
   * 123, Firefox 120 or Safari 17.5. Renaming the function is what an older
   * engine sees: the tokens still parse as custom properties, and every
   * property substituting one becomes invalid at computed-value time.
   *
   * Appended rather than swapped in, because the selectors and specificity are
   * identical, so the later sheet wins — and the page under test is still the
   * one the other lanes load.
   */
  const UNSUPPORTED = css.replaceAll('light-dark(', 'lightdarkunsupported(')

  it('degrades to the host’s own colours, and keeps the accent buttons legible', async () => {
    // The stylesheet's header states this degradation. It said "measured" for
    // one commit while nothing in the tree measured it; this is the
    // measurement, so the sentence and the file cannot drift apart.
    const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    await page.addStyleTag({ content: UNSUPPORTED })
    // Written without helpers: this function is serialised into the page, so
    // anything it calls has to be inside it.
    const read = await page.evaluate(() => {
      const card = document.querySelector<HTMLElement>('.cf-settings')
      const button = document.querySelector<HTMLElement>('.cf-settings button')
      const field = document.querySelector<HTMLElement>('.cf-field input')
      if (card === null || button === null || field === null) return null
      const cardStyle = getComputedStyle(card)
      const buttonStyle = getComputedStyle(button)
      return {
        pageColour: getComputedStyle(document.body).color,
        cardColour: cardStyle.color,
        cardBackground: cardStyle.backgroundColor,
        fieldBackground: getComputedStyle(field).backgroundColor,
        buttonBackground: buttonStyle.backgroundColor,
        buttonColour: buttonStyle.color,
      }
    })
    // Text keeps working: the declaration drops and the host's colour is
    // inherited, which is the right answer for a fragment. Backgrounds fall
    // away too, so the host's own surface shows through.
    expect(read).toEqual({
      pageColour: 'rgb(22, 24, 29)',
      cardColour: 'rgb(22, 24, 29)',
      cardBackground: 'rgba(0, 0, 0, 0)',
      fieldBackground: 'rgba(0, 0, 0, 0)',
      // Except the accent buttons. Losing their fill would leave a primary
      // control reading as plain text, so a feature query hands them literals —
      // and the rename above rewrites that query's own condition, which is what
      // makes this the degradation a real engine would show rather than an
      // approximation of it.
      buttonBackground: 'rgb(11, 92, 171)',
      buttonColour: 'rgb(255, 255, 255)',
    })
  }, 30_000)

  it('still resolves every colour on an engine that has it', async () => {
    // Without this the test above passes on a stylesheet that never used
    // `light-dark()` at all, which is the same assertion for a different tree.
    const { page, context } = await open(lane.browser, ASSEMBLED, { scheme: 'light' })
    onTestFinished(() => context.close())
    const button = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('.cf-settings button')
      return element === null ? null : getComputedStyle(element).backgroundColor
    })
    expect(button).toBe('rgb(11, 92, 171)')
  }, 30_000)
})

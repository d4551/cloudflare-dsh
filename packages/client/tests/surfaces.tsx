/**
 * The host document every browser lane loads, and the pages it loads.
 *
 * Shared by the browser lanes so the accessibility scan, the viewport sweep and
 * the layout lane look at the same markup in the same document. Lanes rendering
 * slightly different pages would be claims about slightly different things; the
 * props themselves live in `fixtures.tsx`, and this module is the document
 * around them.
 */
import type { Browser, BrowserContext, Page } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect } from 'vitest'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'
import { D1ResultToolView } from '../src/toolviews/fromToolCall.tsx'
import { HOST_COMPOSITION, ownerCurrency, settledBlock } from './fixtures.tsx'

/**
 * The stylesheet the package ships, imported rather than reconstructed.
 *
 * Re-exported because the browser lanes scan the same bytes this module styles
 * with: one stylesheet, one source of bytes, no second copy.
 */
import css from '../src/cloudflare.css?raw'

export { css }

/**
 * The client as a host assembles it, in one React tree.
 *
 * One call, not a join of many: `useId` mints ids per render, so rendering each
 * surface separately and concatenating would restart the counter and
 * manufacture id collisions no host would ever produce. The composition itself
 * — which parts are singletons and which repeat per tool call — is stated with
 * the fixtures.
 */
export const ASSEMBLED = renderToStaticMarkup(HOST_COMPOSITION)

/**
 * A wide result set and a long rendered body.
 *
 * The ordinary fixtures are small enough to fit any viewport, which makes them
 * useless for asking whether a narrow one reflows: a two-column table never
 * overflows, so a scroll container that does not work looks identical to one
 * that does.
 */
export const OVERFLOWING = renderToStaticMarkup(
  <>
    <D1Result
      sql="SELECT id, email, created_at, last_seen_at, plan, region FROM users"
      resultSets={[
        {
          results: [
            {
              id: 1,
              email: 'someone.with.a.long.address@example.test',
              created_at: '2026-01-01T00:00:00Z',
              last_seen_at: '2026-09-01T00:00:00Z',
              plan: 'enterprise',
              region: 'weur',
            },
          ],
        },
      ]}
    />
    <BrowserRender
      url="https://example.test/a/rather/long/path/that/will/not/wrap"
      body={`# Title\n${'no-spaces-in-this-line-so-it-cannot-wrap-'.repeat(8)}`}
    />
    <D1ResultToolView
      {...ownerCurrency(
        settledBlock(undefined, [
          { type: 'text', text: 'no-spaces-in-this-line-so-it-cannot-wrap-'.repeat(8) },
        ]),
      )}
    />
  </>,
)

export const THEMES: ReadonlyArray<{ name: string; scheme: 'light' | 'dark' }> = [
  { name: 'light', scheme: 'light' },
  { name: 'dark', scheme: 'dark' },
]

/**
 * What a page may declare as its own colour scheme.
 *
 * The whole legal set for a fixture: accept both and defer to the reader's
 * system, name one and decide, or say nothing and take the initial value.
 */
export type HostScheme = 'light dark' | 'light' | 'dark' | 'normal'

/**
 * The stylesheet a host would serve, around whatever it puts in `<main>`.
 *
 * One host for every browser lane. It supplies what a real one supplies: a
 * colour scheme declared the way pages declare one, and chrome colours read out
 * of the scheme with `light-dark()` rather than branched on, so the page cannot
 * disagree with itself. The shipped stylesheet rides along, because the
 * components under scan are the ones it styles.
 */
export function hostStyles(hostScheme: HostScheme): string {
  return (
    `:root{color-scheme:${hostScheme}}` +
    `body{margin:0;color:light-dark(rgb(22 24 29),rgb(242 243 245));background:light-dark(rgb(255 255 255),rgb(22 24 29))}` +
    css
  )
}

/**
 * The document a host would serve, around whatever it puts in `<main>`.
 *
 * It supplies what a real one supplies: the viewport meta a mobile layout
 * depends on, landmarks, and a page heading. The stylesheet travels separately
 * — {@link hostStyles} — so the document stays markup and the styling stays in
 * one place every lane applies identically.
 */
export function hostPage(main: string): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>Cloudflare surfaces</title></head>` +
    `<body><header><h1>Cloudflare surfaces</h1></header>` +
    `<main>${main}</main></body></html>`
  )
}

/** How a page is opened: colour scheme, and the viewport it is laid out for. */
export interface PageOptions {
  readonly scheme: 'light' | 'dark'
  readonly viewport?: { readonly width: number; readonly height: number } | undefined
  /**
   * What the host declares as its own `color-scheme`.
   *
   * Defaults to accepting both, which is what a page that follows the reader's
   * preference declares. Pinning it to one while `scheme` says the other is how
   * a test asks whose choice these fragments actually follow.
   */
  readonly hostScheme?: HostScheme | undefined
  /**
   * Emulate a touch pointer, which is what makes `(pointer: coarse)` match.
   *
   * Measured rather than assumed: `hasTouch` is the only context option that
   * flips it — `isMobile` alone leaves the pointer fine, so a lane that set
   * only a phone-sized viewport was still testing a mouse.
   */
  readonly touch?: boolean | undefined
  /** Emulate Windows high contrast, which replaces every colour the page chose. */
  readonly forcedColors?: 'active' | undefined
}

/**
 * Load markup into a page with the shipped stylesheet applied.
 *
 * The page comes from an explicit context because `@axe-core/playwright`
 * requires one, and because the viewport is a context property.
 *
 * The page is proved to have rendered before it is handed back. Nearly every
 * check in these lanes filters the document and asserts the filter came back
 * empty — no control below its floor, no clipped text, nothing opted out of the
 * forced palette, no axe violation — and an empty page satisfies every one of
 * them. Measured: fourteen target-size tests and seven text-spacing tests all
 * passed against a selector matching nothing.
 *
 * The expectation is derived from the markup rather than pinned, so it cannot
 * go stale: React's static markup emits one opening tag per element, and that
 * is exactly what the document should end up containing. Comments are not
 * matched, and `main *` does not count them.
 */
export async function open(
  browser: Browser,
  markup: string,
  options: PageOptions,
): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({
    colorScheme: options.scheme,
    ...(options.viewport === undefined ? {} : { viewport: options.viewport }),
    ...(options.touch === undefined ? {} : { hasTouch: options.touch }),
    ...(options.forcedColors === undefined ? {} : { forcedColors: options.forcedColors }),
  })
  const page = await context.newPage()
  await page.setContent(hostPage(markup))
  await page.addStyleTag({ content: hostStyles(options.hostScheme ?? 'light dark') })
  const rendered = await page.evaluate(() => document.querySelectorAll('main *').length)
  expect(rendered, 'the page did not render the markup it was given').toBe(
    (markup.match(/<[a-zA-Z][^>]*>/gu) ?? []).length,
  )
  return { page, context }
}

/**
 * The plumbing the browser lanes share: one browser lifecycle, one way to open
 * a page and close it, and the widths worth laying out.
 *
 * The viewport lane was one file and grew past the monolith bound; the split
 * files register this lifecycle, open pages through this runner, and lay out
 * at this one list of widths, so a width added is a width every file exercises.
 * The overflow fixture lives here too: it is the markup the reflow and
 * document-size checks lay out, and no other lane renders it.
 */
import type { Browser, Page } from 'playwright'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll } from 'vitest'
import { BrowserRender } from '../src/toolviews/BrowserRender.tsx'
import { D1Result } from '../src/toolviews/D1Result.tsx'
import { D1ResultToolView } from '../src/toolviews/fromToolCall.tsx'
import { launch, open, type PageOptions } from './surfaces.tsx'

/**
 * The widths worth laying out.
 *
 * 320 is the reflow criterion's own number. 390 and 430 are the two phone
 * widths in current use; 768 and 1024 are portrait and landscape tablets; 1280
 * and 1920 are the desktop sizes the rest of the suite implicitly assumed.
 */
export const VIEWPORTS = [
  { name: '320 (reflow, 400% zoom)', width: 320, height: 568 },
  { name: '390 (phone)', width: 390, height: 844 },
  { name: '430 (large phone)', width: 430, height: 932 },
  { name: '768 (tablet portrait)', width: 768, height: 1024 },
  { name: '1024 (tablet landscape)', width: 1024, height: 768 },
  { name: '1280 (desktop)', width: 1280, height: 800 },
  { name: '1920 (wide desktop)', width: 1920, height: 1080 },
] as const

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
      callId="call-1"
      toolName="cloudflare_d1_query"
      block={{
        kind: 'tool-result',
        isError: false,
        content: [{ type: 'text', text: 'no-spaces-in-this-line-so-it-cannot-wrap-'.repeat(8) }],
      }}
    />
  </>,
)

/**
 * The shared browser lifecycle a lane file registers.
 *
 * Each lane file calls this once at the top level: the browser launches in
 * `beforeAll` and closes in `afterAll`, and the getter hands it to the tests.
 * A lane that launched its own browser per test would spend its budget on
 * startup, and one that shared a mutable module-level binding would couple
 * every file to every other file's hook order.
 */
export function useBrowser(): { readonly browser: Browser } {
  let browser: Browser | undefined
  beforeAll(async () => {
    browser = await launch()
  }, 60_000)
  afterAll(async () => {
    await browser?.close()
  })
  return {
    get browser(): Browser {
      if (browser === undefined) throw new Error('the shared browser opens in beforeAll')
      return browser
    },
  }
}

/**
 * Open a page, run the checks against it, and close the context either way.
 *
 * Every check in these lanes runs against a context that must be closed whether
 * the checks pass or fail, so the checks are the body of one function and the
 * cleanup rides on the promise: a failing assertion closes the context on its
 * way out, and the failure propagates untouched.
 */
export async function withPage<T>(
  browser: Browser,
  markup: string,
  options: PageOptions,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const { page, context } = await open(browser, markup, options)
  return run(page).finally(() => context.close())
}

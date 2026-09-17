/**
 * One way to open a page, run checks against it, and close the context either
 * way.
 *
 * Every check in these lanes runs against a context that must be closed whether
 * the checks pass or fail, so the checks are the body of one function and the
 * cleanup rides on the promise: a failing assertion closes the context on its
 * way out, and the failure propagates untouched.
 *
 * The widths the lanes lay out at are declared by the lane that lays out at
 * them (`viewport.browser.test.tsx`), and the markup it renders is declared
 * with the markup it is made of (`surfaces.tsx`). Neither lives here, because a
 * second copy of either would drift from the one the run actually uses.
 */
import type { Browser, Page } from 'playwright'
import { open, type PageOptions } from './surfaces.tsx'

/**
 * Open a page, run the checks against it, and close the context either way.
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

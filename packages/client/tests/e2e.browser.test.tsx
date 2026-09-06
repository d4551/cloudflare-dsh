/**
 * The client, mounted and operated in a real browser.
 *
 * Every other lane renders these components to static markup. Static markup
 * has no React attached: a toggle that never toggles, a form that never
 * submits and a live region that never updates all produce markup identical to
 * ones that work, so none of those lanes can tell the difference. This one
 * bundles the real components with the real React, mounts them, and drives the
 * result the way a person would — by keyboard as well as by pointer.
 *
 * The bundle is built here rather than committed so the lane can never drift
 * from the source it claims to exercise.
 */
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import type { Browser, BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hostPage, launch } from './surfaces.tsx'

let browser: Browser
let script: string

beforeAll(async () => {
  browser = await launch()
  const build = await rolldown({
    input: fileURLToPath(new URL('./e2e-entry.tsx', import.meta.url)),
    platform: 'browser',
    // React reads this to pick its development or production branch; without it
    // the bundle keeps a bare `process` reference the browser cannot resolve.
    transform: { define: { 'process.env.NODE_ENV': JSON.stringify('production') } },
  })
  const { output } = await build.generate({ format: 'iife' })
  script = output[0].code
  await build.close()
}, 180_000)

afterAll(async () => {
  await browser?.close()
})

/**
 * Mount the client into a page and wait for React to commit.
 *
 * Takes nothing. It carried a colour scheme and a reduced-motion preference no
 * caller ever passed, which is apparatus that reads as coverage and is not:
 * both belong to the lanes that actually vary them, and this one operates the
 * client.
 */
async function mount(): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext({ colorScheme: 'light' })
  const page = await context.newPage()
  // The same host document every other browser lane loads, so what is operated
  // here is what is scanned there.
  await page.setContent(hostPage(`<div id="root"></div><script>${script}</script>`, 'light dark'))
  await page.waitForSelector('.cf-chip__toggle')
  return { page, context }
}

/**
 * Wait for an element's text to settle, then assert it.
 *
 * React commits asynchronously, so reading straight after an interaction races
 * the render. The wait is what makes the assertion deterministic; the
 * assertion is what makes the failure readable.
 */
async function expectText(page: Page, selector: string, expected: string): Promise<void> {
  await page.waitForFunction(
    ({ selector: sel, expected: want }: { selector: string; expected: string }) =>
      document.querySelector(sel)?.textContent === want,
    { selector, expected },
  )
  expect(await page.locator(selector).textContent()).toBe(expected)
}

/** Wait for an element's visibility to settle, then assert it. */
async function expectVisible(page: Page, selector: string, visible: boolean): Promise<void> {
  await page.locator(selector).waitFor({ state: visible ? 'visible' : 'hidden' })
  expect(await page.locator(selector).isVisible()).toBe(visible)
}

describe('the client, operated', () => {
  it('reveals the detail when the toggle is activated, and hides it again', async () => {
    const { page, context } = await mount()
    try {
      await expectVisible(page, '.cf-chip__detail', false)
      await page.locator('.cf-chip__toggle').click()
      await expectVisible(page, '.cf-chip__detail', true)
      expect(await page.locator('.cf-chip__toggle').getAttribute('aria-expanded')).toBe('true')
      await expectText(page, '.cf-chip__toggle', 'Hide detail')
      await page.locator('.cf-chip__toggle').click()
      await expectVisible(page, '.cf-chip__detail', false)
      await expectText(page, '.cf-chip__toggle', 'Show detail')
    } finally {
      await context.close()
    }
  }, 60_000)

  it('is operable by keyboard alone, which is the whole of SC 2.1.1', async () => {
    const { page, context } = await mount()
    try {
      await page.locator('.cf-chip__toggle').focus()
      // A real button responds to both; a div with a click handler to neither.
      // This is the check that tells those apart.
      await page.keyboard.press('Enter')
      await expectVisible(page, '.cf-chip__detail', true)
      await page.keyboard.press(' ')
      await expectVisible(page, '.cf-chip__detail', false)
    } finally {
      await context.close()
    }
  }, 60_000)

  it('announces a validation error and refuses to save', async () => {
    const { page, context } = await mount()
    try {
      await page.getByLabel('API token reference', { exact: true }).fill('bad ref')
      await page.getByRole('button', { name: 'Save Cloudflare settings' }).click()
      await expectText(
        page,
        '[role="alert"]',
        'A token reference must be an environment variable name: uppercase letters, digits and underscores.',
      )
      expect(await page.getByLabel('API token reference', { exact: true }).getAttribute('aria-invalid')).toBe(
        'true',
      )
      expect(await page.evaluate(() => window.savedCalls.length)).toBe(0)
    } finally {
      await context.close()
    }
  }, 60_000)

  it('saves what was typed, and clears the secret field afterwards', async () => {
    const { page, context } = await mount()
    try {
      await page.getByLabel('Account ID', { exact: true }).fill('acct-9')
      await page.getByLabel('API token', { exact: true }).fill('secret')
      await page.getByRole('button', { name: 'Save Cloudflare settings' }).click()
      await expectText(page, '.cf-saved', 'Cloudflare settings saved.')
      expect(await page.evaluate(() => window.savedCalls)).toEqual([
        [{ apiTokenRef: 'CLOUDFLARE_API_TOKEN', accountId: 'acct-9', gatewayId: '' }, 'secret'],
      ])
      // Write-only: the typed secret does not survive the save.
      expect(await page.getByLabel('API token', { exact: true }).inputValue()).toBe('')
    } finally {
      await context.close()
    }
  }, 60_000)

  it('withdraws the confirmation as soon as a field is edited again', async () => {
    const { page, context } = await mount()
    try {
      await page.getByRole('button', { name: 'Save Cloudflare settings' }).click()
      await expectText(page, '.cf-saved', 'Cloudflare settings saved.')
      await page.getByLabel('Account ID', { exact: true }).fill('acct-9')
      // The confirmation described values that are no longer the stored ones.
      await expectText(page, '.cf-saved', '')
    } finally {
      await context.close()
    }
  }, 60_000)

  it('submits with Enter from a field, as a form is expected to', async () => {
    const { page, context } = await mount()
    try {
      await page.getByLabel('Account ID', { exact: true }).fill('acct-9')
      await page.getByLabel('Account ID', { exact: true }).press('Enter')
      await expectText(page, '.cf-saved', 'Cloudflare settings saved.')
    } finally {
      await context.close()
    }
  }, 60_000)
})

import { defineConfig } from 'vitest/config'
import { aliases } from './tests/aliases.ts'

/**
 * The real-browser accessibility lane.
 *
 * Separate from the unit config because it drives Chromium through Playwright:
 * it is a different runner, so it sits outside the Stryker run by construction
 * rather than by exclusion.
 */

/**
 * Each test launches a real Chromium page and runs the whole axe rule set in
 * it, which takes seconds rather than milliseconds; the budget is finite so a
 * hung browser still fails.
 */
const BROWSER_TEST_TIMEOUT_MS = 60_000

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.browser.test.tsx'],
    exclude: ['**/node_modules/**'],
    testTimeout: BROWSER_TEST_TIMEOUT_MS,
    hookTimeout: BROWSER_TEST_TIMEOUT_MS,
    /**
     * Process CSS, so the shipped stylesheet's bytes reach the lanes. The
     * lanes load it with a `?raw` import, and with CSS processing off vitest
     * rewrites every CSS module — raw imports included — to an empty string,
     * which styles no page and scans no bytes.
     */
    css: true,
  },
})

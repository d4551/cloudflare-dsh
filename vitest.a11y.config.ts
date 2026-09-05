import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The real-browser accessibility lane.
 *
 * Separate from the unit config because it drives Chromium through Playwright:
 * it is a different runner, so it sits outside the Stryker run by construction
 * rather than by exclusion.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@d4551/dsh-cloudflare-core': r('./packages/core/src/index.ts'),
      '@d4551/dsh-cloudflare-client': r('./packages/client/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.browser.test.tsx'],
    exclude: ['**/node_modules/**'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})

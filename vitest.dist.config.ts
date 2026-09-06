import { defineConfig } from 'vitest/config'

/**
 * Verifies built output. Deliberately has no source aliases: this suite must
 * resolve the packages the way a consumer would, not the way the repo does.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/dist.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})

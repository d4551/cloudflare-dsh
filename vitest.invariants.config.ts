import { defineConfig } from 'vitest/config'

/**
 * Repository invariants.
 *
 * Its own lane because it inspects the repository rather than the source: it
 * reads gate configuration and scans tracked files, so it must run against the
 * real working tree and not against a copy that a tool has rewritten.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/invariants.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})

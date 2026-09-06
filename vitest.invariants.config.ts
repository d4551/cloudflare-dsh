import { defineConfig } from 'vitest/config'

/**
 * The repository's own gates: the invariants, and the mutation guard's checks.
 *
 * Their own lane because the invariants inspect the repository rather than the
 * source — they read gate configuration and scan the files git would commit,
 * so they must run against the real working tree and not a copy a tool has
 * rewritten — and because the guard polices the mutation run rather than being
 * part of it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/invariants.test.ts', 'tests/mutation-guard.test.ts'],
    exclude: ['**/node_modules/**'],
  },
})

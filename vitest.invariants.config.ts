import { defineConfig } from 'vitest/config'

/**
 * The repository's own gates: the invariants, the mutation guard's checks, and
 * the README's claims and diagrams.
 *
 * Their own lane because these suites inspect the repository rather than the
 * source — they read gate configuration and scan the files git would commit,
 * so they must run against the real working tree and not a copy a tool has
 * rewritten — and because the guard polices the mutation run rather than being
 * part of it. The gate modules under `tests/gates/` are split by responsibility
 * out of the single file they used to be.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/invariants.test.ts',
      'tests/gates/*.test.ts',
      'tests/mutation-guard.test.ts',
      'tests/readme.test.ts',
    ],
    exclude: ['**/node_modules/**'],
  },
})

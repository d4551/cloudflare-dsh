import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'packages/client/tests/**'],
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      thresholds: { lines: 99, branches: 99, functions: 99, statements: 99 },
    },
  },
})

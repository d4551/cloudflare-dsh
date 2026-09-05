import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@d4551/dsh-cloudflare-core': r('./packages/core/src/index.ts'),
      '@d4551/dsh-cloudflare-client': r('./packages/client/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts', 'packages/*/tests/**/*.test.tsx'],
    exclude: ['**/node_modules/**'],
    pool: 'threads',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx'],
      thresholds: { lines: 99, branches: 99, functions: 99, statements: 99 },
    },
  },
})

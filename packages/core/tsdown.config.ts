import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  // Cordis is a peer the harness supplies; schemastery is a runtime dependency.
  // Both stay unbundled so the harness resolves a single copy of each.
  deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'] },
})

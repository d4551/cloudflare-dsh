import { defineConfig } from 'tsdown'

export default defineConfig({
  // One entry per published subpath: the plugin root plus the seven modules
  // the exports map publishes. retry, scope and credentials stay internal —
  // they are bundled into the entries that import them.
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/config.ts',
    'src/errors.ts',
    'src/paginate.ts',
    'src/request.ts',
    'src/service.ts',
    'src/types.ts',
  ],
  outDir: 'lib',
  format: 'esm',
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  // Cordis is a peer the harness supplies; schemastery is a runtime dependency.
  // Both stay unbundled so the harness resolves a single copy of each.
  deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'] },
})

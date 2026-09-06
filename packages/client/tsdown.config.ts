import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  copy: [{ from: 'src/cloudflare.css', to: 'lib' }],
  // React and Cordis are supplied by the Web Client.
  deps: { neverBundle: ['@deepseek-ai/cordis', 'react', 'react/jsx-runtime'] },
})

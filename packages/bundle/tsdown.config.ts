import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/tools/ai.ts',
    'src/tools/data.ts',
    'src/tools/web.ts',
    'src/tools/meta.ts',
    'src/ai/index.ts',
    'src/mcp/index.ts',
  ],
  outDir: 'lib',
  format: 'esm',
  dts: { sourcemap: true },
  sourcemap: true,
  clean: true,
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-attachment',
      '@d4551/dsh-cloudflare-core',
    ],
  },
})

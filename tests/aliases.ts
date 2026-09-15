/**
 * Source aliases shared by every vitest config.
 *
 * The suites import the two workspace packages by their published specifiers —
 * the bare name for each plugin entry and one subpath per published core
 * module — so the tests exercise the same import paths a consumer writes.
 * Aliasing those specifiers to `src` keeps the runs on source rather than on a
 * stale build, which is why each published subpath is listed explicitly.
 */
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/** The core modules published as subpaths, in exports-map order. */
const CORE_MODULES = ['client', 'config', 'errors', 'paginate', 'request', 'service', 'types'] as const

export const aliases = [
  { find: '@d4551/dsh-cloudflare-core', replacement: r('./packages/core/src/index.ts') },
  ...CORE_MODULES.map((module) => ({
    find: `@d4551/dsh-cloudflare-core/${module}`,
    replacement: r(`./packages/core/src/${module}.ts`),
  })),
  { find: '@d4551/dsh-cloudflare-client', replacement: r('./packages/client/src/index.ts') },
]

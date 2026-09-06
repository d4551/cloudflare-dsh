/**
 * Verifies the published artifacts, not the sources.
 *
 * Every other suite runs against `src` through a path alias, so nothing
 * previously proved that what actually ships loads at all. This loads each
 * built entry point exactly as a harness would resolve it, and checks that the
 * subpaths `cordis.patch.yml` names are real.
 *
 * Runs from its own config because it requires `bun run build` first.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url))

interface Manifest {
  name: string
  version: string
  exports: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string }; client?: boolean }
}

function manifest(pkg: string): Manifest {
  return JSON.parse(readFileSync(root(`../packages/${pkg}/package.json`), 'utf8')) as Manifest
}

/** Resolve one export subpath to a file, the way Node would. */
function resolveExport(pkg: string, subpath: string): string {
  const m = manifest(pkg)
  const entry = m.exports[subpath]
  const target = typeof entry === 'string' ? entry : (entry as { default: string }).default
  return root(`../packages/${pkg}/${target.replace(/^\.\//, '')}`)
}

describe('published manifests', () => {
  it.each(['core', 'bundle', 'client'])('%s declares no workspace protocol in dependencies', (pkg) => {
    const m = manifest(pkg)
    const ranges = Object.values({ ...m.dependencies, ...m.peerDependencies })
    // `workspace:*` cannot be resolved by anyone installing from the registry.
    expect(ranges.filter((r) => r.startsWith('workspace:'))).toEqual([])
  })

  it('the bundle declares its dsh patch, without which it installs inert', () => {
    expect(manifest('bundle').dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('the client declares itself a client plugin, without which the host never loads it', () => {
    // The bundle's flag had this test and the client's identical one did not.
    // Drop `dsh.client` and every surface this package contributes is inert —
    // while the component tests, the Chromium scans and the viewport lane all
    // keep passing, because none of them loads the package the way a host does.
    expect(manifest('client').dsh?.client).toBe(true)
  })
})

describe('built artifacts', () => {
  const entries: ReadonlyArray<[string, string]> = [
    ['core', '.'],
    ['bundle', './tools/ai'],
    ['bundle', './tools/data'],
    ['bundle', './tools/web'],
    ['bundle', './tools/meta'],
    ['bundle', './ai'],
    ['bundle', './mcp'],
    ['client', '.'],
    ['client', './client'],
  ]

  it.each(entries)('%s %s points at a file that exists', (pkg, subpath) => {
    expect(existsSync(resolveExport(pkg, subpath))).toBe(true)
  })

  it.each(entries)('%s %s loads and exports something', async (pkg, subpath) => {
    const mod = (await import(resolveExport(pkg, subpath))) as Record<string, unknown>
    expect(Object.keys(mod).length).toBeGreaterThan(0)
  })

  it.each([
    ['bundle', './tools/ai'],
    ['bundle', './tools/data'],
    ['bundle', './tools/web'],
    ['bundle', './tools/meta'],
  ])('%s %s ships a loadable cordis plugin', async (pkg, subpath) => {
    const mod = (await import(resolveExport(pkg, subpath))) as {
      name?: string
      inject?: readonly string[]
      apply?: unknown
    }
    expect(typeof mod.name).toBe('string')
    expect(mod.inject).toContain('cloudflare')
    expect(typeof mod.apply).toBe('function')
  })

  it('the built client ships its stylesheet', () => {
    expect(existsSync(resolveExport('client', './cloudflare.css'))).toBe(true)
  })
})

describe('cordis.patch.yml', () => {
  const patch = readFileSync(root('../packages/bundle/cordis.patch.yml'), 'utf8')

  /** Every module specifier the patch asks the loader to resolve. */
  const specifiers = [...patch.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]!)

  it('names exactly the seam, the model provider and the four tool groups', () => {
    expect(specifiers).toEqual([
      '@d4551/dsh-cloudflare-core',
      'cloudflare-dsh/tools/ai',
      'cloudflare-dsh/tools/data',
      'cloudflare-dsh/tools/web',
      'cloudflare-dsh/ai',
      'cloudflare-dsh/tools/meta',
    ])
  })

  it.each([
    'cloudflare-dsh/tools/ai',
    'cloudflare-dsh/tools/data',
    'cloudflare-dsh/tools/web',
    'cloudflare-dsh/tools/meta',
    'cloudflare-dsh/ai',
  ])('%s is a subpath the bundle actually exports', (specifier) => {
    expect(specifiers).toContain(specifier)
    const subpath = specifier.replace('cloudflare-dsh', '.')
    // A declared subpath proves nothing on its own: resolve it the way Node
    // would and require the file to be on disk.
    expect(existsSync(resolveExport('bundle', subpath))).toBe(true)
  })

  it('names the core package by the name it publishes under', () => {
    expect(specifiers).toContain(manifest('core').name)
  })

  it('resolves the core package from the bundle, and to its built entry', () => {
    // Resolution has to start where the bundle lives: that is the position a
    // consumer's installed copy of the bundle would resolve from.
    const fromBundle = createRequire(root('../packages/bundle/package.json'))
    expect(fromBundle.resolve(manifest('core').name)).toBe(resolveExport('core', '.'))
  })
})

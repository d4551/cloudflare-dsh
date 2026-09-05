import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

/** One row of the layer this bundle contributes. */
interface PatchRow {
  readonly id: string
  readonly name: string
  readonly config?: Readonly<Record<string, unknown>>
}

/**
 * The patch, parsed rather than string-matched.
 *
 * Every assertion here used to run against raw text, so a syntactically invalid
 * patch passed the whole suite while `dsh` would reject it at load.
 */
const layers = parse(patch) as ReadonlyArray<{ readonly insert?: readonly PatchRow[] }>
const rows: readonly PatchRow[] = layers.flatMap((layer) => layer.insert ?? [])
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  name: string
  exports: Record<string, unknown>
  dsh?: { bundle?: { patch?: string } }
  files: string[]
  keywords: string[]
}

describe('bundle manifest', () => {
  it('declares dsh.bundle.patch, without which the package installs inert', () => {
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('ships the patch and presets alongside the build output', () => {
    expect(manifest.files).toEqual(expect.arrayContaining(['lib', 'cordis.patch.yml', 'presets']))
  })

  it('carries the dsh-plugin topic keyword used for discovery', () => {
    expect(manifest.keywords).toContain('dsh-plugin')
  })

  it('exports a subpath for every tool group the patch references', () => {
    for (const subpath of ['./tools/ai', './tools/data', './tools/web', './tools/meta']) {
      expect(manifest.exports[subpath]).toEqual({
        types: `./lib${subpath.slice(1)}.d.mts`,
        default: `./lib${subpath.slice(1)}.mjs`,
      })
    }
  })
})

describe('cordis.patch.yml', () => {
  it('is valid YAML shaped as a list of insert layers', () => {
    expect(Array.isArray(layers)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(typeof row.id).toBe('string')
      expect(typeof row.name).toBe('string')
    }
  })

  it('gives every row a unique id, since a collision would silently drop one', () => {
    expect([...new Set(rows.map((row) => row.id))]).toHaveLength(rows.length)
  })

  it('mounts the capability seam', () => {
    expect(rows.map((row) => row.name)).toContain('@d4551/dsh-cloudflare-core')
  })

  it('references each tool group by its published subpath specifier', () => {
    const names = rows.map((row) => row.name)
    for (const group of ['ai', 'data', 'web', 'meta']) {
      expect(names).toContain(`cloudflare-dsh/tools/${group}`)
    }
  })

  it('mounts the model provider, without which the adapter never activates', () => {
    expect(rows.map((row) => row.name)).toContain('cloudflare-dsh/ai')
  })

  it('names the credential by reference rather than embedding a secret', () => {
    const seam = rows.find((row) => row.name === '@d4551/dsh-cloudflare-core')
    expect(seam?.config?.apiTokenRef).toBe('CLOUDFLARE_API_TOKEN')
  })

  it('carries no secret-shaped value in any row, whatever the key is called', () => {
    // The previous check matched the single spelling `apiToken:`; a secret under
    // any other key passed. This inspects every value in every row instead.
    const secretish = /^(?:.*(?:token|secret|password|key))$/i
    const offenders = rows.flatMap((row) =>
      Object.entries(row.config ?? {})
        .filter(([key]) => secretish.test(key) && !key.endsWith('Ref'))
        .map(([key]) => `${row.id}.${key}`),
    )
    expect(offenders).toEqual([])
  })

  it('ships the generic API tool read-only by default', () => {
    const meta = rows.find((row) => row.name === 'cloudflare-dsh/tools/meta')
    expect(meta?.config?.allowMutations).toBe(false)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')

/** The JSON value shape the YAML parser hands back for this document. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** Whether a parsed value is an object, and not an array or null. */
function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a string; an absent field is not. */
function isString(value: JsonValue | undefined): value is string {
  return typeof value === 'string'
}

/** One row of the layer this bundle contributes. */
type PatchRow = {
  readonly id: string
  readonly name: string
  readonly config?: Readonly<Record<string, JsonValue>>
}

/** Whether a parsed value is one patch row: an object with string id and name. */
function isPatchRow(row: JsonValue): row is PatchRow {
  return isJsonObject(row) && isString(row.id) && isString(row.name)
}

/** Whether a parsed value is the list of insert layers the patch file holds. */
function isPatchLayers(value: JsonValue): value is { insert?: PatchRow[] }[] {
  return (
    Array.isArray(value) &&
    value.every(
      (layer) =>
        isJsonObject(layer) &&
        (layer.insert === undefined || (Array.isArray(layer.insert) && layer.insert.every(isPatchRow))),
    )
  )
}

/**
 * The patch, parsed rather than string-matched.
 *
 * Every assertion here used to run against raw text, so a syntactically invalid
 * patch passed the whole suite while `dsh` would reject it at load. The parse
 * result is taken as its JSON value shape once, at this boundary, and every
 * assertion after it runs through the shape predicates above.
 */
const parsed = parse(patch) as JsonValue
const layers = isPatchLayers(parsed) ? parsed : []
const rows: readonly PatchRow[] = layers.flatMap((layer) => layer.insert ?? [])
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as {
  name: string
  exports: Record<string, JsonValue>
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

  it('exports a subpath for every tool group the patch names', () => {
    for (const subpath of ['./tools/ai', './tools/data', './tools/web', './tools/meta']) {
      // The tool groups are directory modules, so their entries build to an
      // index file; web and meta stay single-file modules.
      const built =
        subpath === './tools/ai' || subpath === './tools/data'
          ? `${subpath.slice(1)}/index`
          : subpath.slice(1)
      expect(manifest.exports[subpath]).toEqual({
        types: `./lib${built}.d.mts`,
        default: `./lib${built}.mjs`,
      })
    }
  })
})

describe('cordis.patch.yml', () => {
  it('is valid YAML shaped as a list of insert layers', () => {
    expect(Array.isArray(layers)).toBe(true)
    expect(rows.length).toBeGreaterThan(0)
    // Named rather than counted: a boolean collapses the failure to
    // `false !== true` and says nothing about which row is malformed.
    expect(rows.filter((row) => typeof row.id !== 'string' || typeof row.name !== 'string')).toEqual([])
  })

  it('gives every row a unique id, since a collision would silently drop one', () => {
    expect([...new Set(rows.map((row) => row.id))]).toHaveLength(rows.length)
  })

  it('mounts the capability seam', () => {
    expect(rows.map((row) => row.name)).toContain('@d4551/dsh-cloudflare-core')
  })

  it('mounts each tool group under its published subpath specifier', () => {
    const names = rows.map((row) => row.name)
    // As a set, so an empty group list cannot make this pass by asserting
    // nothing — which a loop over one would.
    expect(names.filter((name) => name.startsWith('cloudflare-dsh/tools/')).toSorted()).toEqual([
      'cloudflare-dsh/tools/ai',
      'cloudflare-dsh/tools/data',
      'cloudflare-dsh/tools/meta',
      'cloudflare-dsh/tools/web',
    ])
  })

  it('mounts the model provider, without which no model call can resolve', () => {
    expect(rows.map((row) => row.name)).toContain('cloudflare-dsh/ai')
  })

  it('resolves the credential from the harness credential service, never as a literal value', () => {
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

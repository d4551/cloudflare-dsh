import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
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
      expect(manifest.exports[subpath]).toBeDefined()
    }
  })
})

describe('cordis.patch.yml', () => {
  it('mounts the capability seam', () => {
    expect(patch).toContain("name: '@d4551/dsh-cloudflare-core'")
  })

  it('references each tool group by its published subpath specifier', () => {
    for (const group of ['ai', 'data', 'web', 'meta']) {
      expect(patch).toContain(`name: 'cloudflare-dsh/tools/${group}'`)
    }
  })

  it('mounts the model provider, without which the adapter never activates', () => {
    expect(patch).toContain("name: 'cloudflare-dsh/ai'")
  })

  it('names the credential by reference rather than embedding a secret', () => {
    expect(patch).toContain('apiTokenRef: CLOUDFLARE_API_TOKEN')
    expect(patch).not.toMatch(/apiToken:\s*\S/)
  })

  it('ships the generic API tool read-only by default', () => {
    expect(patch).toContain('allowMutations: false')
  })
})

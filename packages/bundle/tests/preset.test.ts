import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { CloudflareConfig } from '@d4551/dsh-cloudflare-core'
import * as aiTools from '../src/tools/ai.ts'
import * as metaTools from '../src/tools/meta.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The shipped preset, which nothing read.
 *
 * `presets/pi-ai.yaml` is listed in the package's `files` and documented on the
 * page as a zero-code path, and the only thing any test said about it was that
 * the manifest mentions the directory. It could have been malformed YAML, or
 * have named a credential reference this plugin does not default to, or two
 * tools that no longer exist, and every gate would have stayed green — it is a
 * shipped artifact, so a reader would have found out instead.
 */
const preset = readFileSync(fileURLToPath(new URL('../presets/pi-ai.yaml', import.meta.url)), 'utf8')

interface Preset {
  readonly 'llm-pi-ai': {
    readonly providers: Readonly<
      Record<string, { readonly apiKeyEnv: string; readonly models: readonly { readonly id: string }[] }>
    >
  }
}

describe('presets/pi-ai.yaml', () => {
  it('is valid YAML shaped as a provider block the harness can merge', () => {
    const parsed = parse(preset) as Preset
    expect(Object.keys(parsed['llm-pi-ai'].providers)).toEqual(['cf-gateway'])
  })

  it('names the credential reference this plugin defaults to', () => {
    // The preset tells a reader to store their token under this name. If the
    // seam's default moved, the instruction would send them to the wrong one.
    const parsed = parse(preset) as Preset
    expect(parsed['llm-pi-ai'].providers['cf-gateway']?.apiKeyEnv).toBe(CloudflareConfig({}).apiTokenRef)
  })

  it('offers a Workers AI model, since a gateway with no model configured routes nothing', () => {
    const parsed = parse(preset) as Preset
    const models = parsed['llm-pi-ai'].providers['cf-gateway']?.models ?? []
    expect(models.map((model) => model.id)).toEqual(['@cf/meta/llama-3.1-8b-instruct'])
  })

  it('names only tools this bundle actually registers', () => {
    // The comment block walks a reader through resolving their gateway URL by
    // calling two tools by name. A rename would leave the instructions pointing
    // at nothing.
    const named = [...preset.matchAll(/cloudflare_[a-z0-9_]+/gu)].map((match) => match[0])
    expect(named.length).toBeGreaterThan(0)
    const registered = new Set([
      ...makeHarness(aiTools, async () => envelope(null)).names(),
      ...makeHarness(metaTools, async () => envelope(null)).names(),
    ])
    expect(named.filter((name) => !registered.has(name))).toEqual([])
  })
})

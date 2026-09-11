/**
 * The gate configuration cannot be softened.
 *
 * A rule that is only documented holds until someone edits a config, and
 * nothing goes red when they do — so the configuration of every other gate is
 * itself gated here: severities, plugin lists, the mutation budget, the
 * coverage block, the type checker's options and the unused-code scanner's
 * reach.
 */
import { describe, expect, it } from 'vitest'
import {
  type ConfigValue,
  type OxlintConfig,
  type OxfmtConfig,
  type PackageJson,
  containing,
  json,
  read,
  sources,
} from './base.ts'

/** A rule entry's severity, whether written bare or beside its options. */
const severityOf = (value: ConfigValue): ConfigValue | undefined => (Array.isArray(value) ? value[0] : value)

/** An exact package version, the only spelling a pin can take. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/

describe('formatting cannot drift', () => {
  // A formatter run across the tree once rewrote 23 files while every other
  // gate stayed green. A canonical style is only a rule if something fails
  // when a file departs from it.
  it('checks formatting rather than applying it', () => {
    expect(json<PackageJson>('package.json').scripts['format:check']).toBe('oxfmt --check')
  })

  it('has no per-file overrides', () => {
    expect(json<OxfmtConfig>('.oxfmtrc.json').overrides).toBeUndefined()
  })

  it('pins the formatter exactly, since a new version can change what canonical means', () => {
    expect(json<PackageJson>('package.json').devDependencies['oxfmt']).toMatch(EXACT_VERSION)
  })
})

describe('linting cannot be softened', () => {
  it('configures rules and never softens one', () => {
    // A rule entry may teach a rule something true about this codebase; it may
    // not lower a severity. Every entry is checked to be an error, whether it
    // is written as a bare severity or as a severity with options — so `off`
    // and `warn` cannot appear, and a `rules` block cannot become the place a
    // finding goes to be silenced.
    const rules = Object.entries(json<OxlintConfig>('.oxlintrc.json').rules ?? {})
    expect(rules.filter(([, value]) => severityOf(value) !== 'error').map(([id]) => id)).toEqual([])
  })

  it('ignores only what git ignores, so no source can be excused from the lint', () => {
    const gitignored = new Set(
      read('.gitignore')
        .split('\n')
        .filter((line) => line.endsWith('/'))
        .map((line) => line.slice(0, -1)),
    )
    const patterns = json<OxlintConfig>('.oxlintrc.json').ignorePatterns ?? []
    expect(patterns.filter((pattern) => !gitignored.has(pattern))).toEqual([])
  })

  it('has no const assertion in source, which would remove values from mutation', () => {
    // Stryker does not mutate inside a const assertion; one once removed a
    // whole file from a report.
    expect(containing(sources, 'as const')).toEqual([])
    expect(containing(sources, `<con${'st>'}`)).toEqual([])
  })
})

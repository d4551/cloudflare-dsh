/**
 * The linter and the formatter, as gates.
 *
 * Two tools decide how every other gate reads the tree: the linter grades what
 * the compiler accepts, and the formatter decides what canonical means. Both
 * are configured in a file, and a rule set to `off`, a plugin dropped from the
 * list, or a per-file override softens every gate downstream while each of
 * them still reports a full pass. These read those configuration files and
 * hold them to what the page states.
 *
 * The other configuration gates — coverage, mutation, pinning, manifests —
 * live in `config.test.ts`; the two files used to carry a copy of this one
 * each, so every assertion below ran twice and a fix could land in one copy
 * only.
 */
import { describe, expect, it } from 'vitest'
import { containing, json, read } from './base.ts'
import { EXACT_VERSION, type Json, type OxfmtConfig, type OxlintConfig, type PackageJson } from './repo.ts'

/** A rule entry's severity, whether written bare or beside its options. */
const severityOf = (value: Json): Json | undefined => (Array.isArray(value) ? value[0] : value)

/**
 * The names a tool's ignore list has to be drawn from: the directories git
 * ignores.
 *
 * Derived once, because both the linter's list and the formatter's are checked
 * against it and a second derivation is a second thing to keep true.
 */
const gitignored = (): string[] =>
  read('.gitignore')
    .split('\n')
    .filter((line) => line.endsWith('/'))
    .map((line) => line.slice(0, -1))

describe('linting cannot be softened', () => {
  it('grades every enabled category as an error', () => {
    const { categories } = json<OxlintConfig>('.oxlintrc.json')
    expect(Object.entries(categories).filter(([, level]) => level !== 'error')).toEqual([])
  })

  it('keeps every category that must be graded, so none can be dropped', () => {
    // Asserting only that present categories are errors is checkable by
    // omission: deleting one leaves an empty filter and a green gate.
    expect(Object.keys(json<OxlintConfig>('.oxlintrc.json').categories).toSorted()).toEqual([
      'correctness',
      'perf',
      'suspicious',
    ])
  })

  it('fails the build on a warning', () => {
    expect(json<PackageJson>('package.json').scripts.lint).toContain('--deny-warnings')
  })

  it('runs exactly these plugins, so dropping one is a visible edit', () => {
    // The formatter's ignore list was gated and the linter's plugin list was
    // not, so `typescript` could have been removed with every gate green.
    // `jsx-a11y` is the static half of the accessibility bar; `import`,
    // `promise` and `vitest` each found a real defect the day they went on.
    expect(json<OxlintConfig>('.oxlintrc.json').plugins.toSorted()).toEqual([
      'import',
      'jsx-a11y',
      'oxc',
      'promise',
      'typescript',
      'unicorn',
      'vitest',
    ])
  })

  it('ignores only what git ignores, so no source can be excused from the lint', () => {
    // As a filter over the whole list rather than an assertion per entry: a
    // loop over an empty list asserts nothing and passes.
    const patterns = json<OxlintConfig>('.oxlintrc.json').ignorePatterns ?? []
    const ignored = gitignored()
    expect(patterns.filter((pattern) => !ignored.includes(pattern))).toEqual([])
  })

  it('configures rules and never softens one', () => {
    // A rule entry may teach a rule something true about this codebase; it may
    // not lower a severity. Every entry is checked to be an error, whether it
    // is written as a bare severity or as a severity with options — so `off`
    // and `warn` cannot appear, and a `rules` block cannot become the place a
    // finding goes to be silenced.
    const rules = Object.entries(json<OxlintConfig>('.oxlintrc.json').rules ?? {})
    expect(rules.filter(([, value]) => severityOf(value) !== 'error').map(([id]) => id)).toEqual([])
  })

  it('overrides exactly these rules, each for a reason the tree can show', () => {
    // Named, so a new override is a reviewed edit rather than a quiet one.
    // Each of these teaches a rule a fact about this codebase that it has no
    // way to know: a scrollable figure is a legitimate focus stop and axe
    // requires it to be one, the axe helper is an assertion helper, and
    // Vitest's `expect` genuinely takes a message as its second argument.
    expect(Object.keys(json<OxlintConfig>('.oxlintrc.json').rules ?? {}).toSorted()).toEqual([
      'jsx-a11y/no-noninteractive-tabindex',
      'vitest/expect-expect',
      'vitest/valid-expect',
    ])
  })
})

describe('formatting cannot drift', () => {
  // A formatter run across the tree once rewrote 23 files while every other
  // gate stayed green. A canonical style is only a rule if something fails
  // when a file departs from it.
  it('checks formatting rather than applying it', () => {
    expect(json<PackageJson>('package.json').scripts['format:check']).toBe('oxfmt --check')
  })

  it('ignores only what git ignores, so no source can be excused from the check', () => {
    const patterns = json<OxfmtConfig>('.oxfmtrc.json').ignorePatterns ?? []
    const ignored = gitignored()
    expect(patterns.filter((pattern) => !ignored.includes(pattern))).toEqual([])
  })

  it('has no per-file overrides', () => {
    expect(json<OxfmtConfig>('.oxfmtrc.json').overrides).toBeUndefined()
  })

  it('pins the formatter exactly, since a new version can change what canonical means', () => {
    expect(json<PackageJson>('package.json').devDependencies['oxfmt']).toMatch(EXACT_VERSION)
  })
})

describe('the ignore lists this gate holds are the ones it read', () => {
  it('finds a list in each configuration file', () => {
    // Both assertions above filter a list that could be absent: an empty list
    // makes each of them pass without holding anything. The files are named
    // here so that a key removed from either one is a failure rather than a
    // quieter gate.
    expect(containing(['.oxlintrc.json', '.oxfmtrc.json'], 'ignorePatterns')).toEqual([
      '.oxlintrc.json',
      '.oxfmtrc.json',
    ])
  })
})

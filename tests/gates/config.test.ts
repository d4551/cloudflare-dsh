/**
 * The configuration gates: coverage, linting, formatting, pinning, manifests.
 *
 * Each gate a tool carries can be narrowed by editing the tool's config, and
 * every other gate stays green while the metric shrinks. These read the
 * configuration files themselves and hold them to what the page states.
 */
import { describe, expect, it } from 'vitest'
import type {
  Json,
  KnipConfig,
  OxfmtConfig,
  OxlintConfig,
  PackageJson,
  StrykerConfig,
  TsConfig,
  TsConfigBase,
} from './support.ts'
import { containing, json, read, sources, tracked } from './support.ts'

describe('mutation testing cannot be narrowed', () => {
  it('mutates every source extension, with no negated pattern', () => {
    expect(json<StrykerConfig>('stryker.config.json').mutate).toEqual([
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
    ])
  })

  it('fails the run below a perfect score', () => {
    expect(json<StrykerConfig>('stryker.config.json').thresholds).toEqual({ high: 100, low: 100, break: 100 })
  })

  it('runs the escape guard after the mutation run', () => {
    expect(json<PackageJson>('package.json').scripts.stryker).toBe(
      'stryker run && bun scripts/verify-mutation-files.ts',
    )
  })

  it('has no const assertion in source, which would remove values from mutation', () => {
    // Stryker does not mutate inside a const assertion. One of these once hid a
    // whole locale dictionary behind a report that read as complete.
    expect(containing(sources, 'as const')).toEqual([])
    expect(containing(sources, `<con${'st>'}`)).toEqual([])
  })
})

describe('coverage cannot be softened', () => {
  it('requires 100 on every metric', () => {
    const found = [...read('vitest.config.ts').matchAll(/(lines|branches|functions|statements):\s*(\d+)/g)]
    expect(found.map((match) => [match[1], Number(match[2])])).toEqual([
      ['lines', 100],
      ['branches', 100],
      ['functions', 100],
      ['statements', 100],
    ])
  })

  it('excludes nothing from the measurement', () => {
    // `coverage.exclude: ['packages/bundle/src/**']` would leave every other
    // assertion in this block passing while the metric measured almost nothing.
    // The lane-separation `test.exclude` is a different key and is legitimate,
    // so this reads the coverage block alone rather than the whole file.
    const config = read('vitest.config.ts')
    const start = config.indexOf('coverage: {')
    expect(start).toBeGreaterThan(-1)
    const block = config.slice(start, config.indexOf('\n    }', start))
    expect(block).not.toContain('exclude')
  })

  it('measures every source extension', () => {
    expect(read('vitest.config.ts')).toContain(
      "include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx']",
    )
  })
})

/** A rule entry's severity, whether written bare or beside its options. */
const severityOf = (value: Json): Json => (Array.isArray(value) ? (value[0] ?? '') : value)

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
    const gitignored = new Set(
      read('.gitignore')
        .split('\n')
        .filter((line) => line.endsWith('/'))
        .map((line) => line.slice(0, -1)),
    )
    // As a filter over the whole list rather than an assertion per entry: a
    // loop over an empty list asserts nothing and passes.
    const patterns = json<OxlintConfig>('.oxlintrc.json').ignorePatterns ?? []
    expect(patterns.filter((pattern) => !gitignored.has(pattern))).toEqual([])
  })

  it('configures rules and never softens one', () => {
    // A rule entry may teach a rule something true about this codebase; it may
    // not lower a severity. Every entry is checked to be an error, whether it
    // is written as a bare severity or as a severity with options — so `off`
    // and `warn` cannot appear, and a `rules` block cannot become the place a
    // finding goes to be silenced.
    const rules = Object.entries(json<OxlintConfig>('.oxlintrc.json').rules ?? {})
    expect(rules.filter(([, value]) => severityOf(value ?? '') !== 'error').map(([id]) => id)).toEqual([])
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
    const gitignored = read('.gitignore')
      .split('\n')
      .filter((line) => line.endsWith('/'))
      .map((line) => line.slice(0, -1))
    for (const pattern of json<OxfmtConfig>('.oxfmtrc.json').ignorePatterns ?? []) {
      expect(gitignored).toContain(pattern)
    }
  })

  it('has no per-file overrides', () => {
    expect(json<OxfmtConfig>('.oxfmtrc.json').overrides).toBeUndefined()
  })

  it('pins the formatter exactly, since a new version can change what canonical means', () => {
    expect(json<PackageJson>('package.json').devDependencies['oxfmt']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('the runner and the mutator are pinned', () => {
  // A range here is not a version bump, it is a silent change of what the
  // mutation score means. On Vitest 5 the Stryker vitest runner's per-test
  // filter matches nothing and every covered mutant reports as surviving
  // (stryker-js issue 6210, still open), so a caret on `vitest` would turn a
  // 100% gate into a meaningless one with nothing going red.
  it.each(['vitest', '@vitest/coverage-v8', '@stryker-mutator/core', '@stryker-mutator/vitest-runner'])(
    'pins %s to an exact version',
    (name) => {
      expect(json<PackageJson>('package.json').devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/)
    },
  )

  it('keeps the runner and its coverage provider on the same version', () => {
    const { devDependencies } = json<PackageJson>('package.json')
    expect(devDependencies['@vitest/coverage-v8']).toBe(devDependencies['vitest'])
  })
})

describe('the types describe the runtime the manifests require', () => {
  /** Every published manifest, plus the root, read from what git tracks. */
  const manifests = tracked.filter((file) => /^(?:packages\/[^/]+\/)?package\.json$/u.test(file))

  it('finds the root manifest and one per package', () => {
    // An empty list would satisfy the assertion below without reading a thing.
    expect(manifests.length).toBe(4)
  })

  it('asks every manifest for the same Node', () => {
    // A package published with a lower floor than the tree is built against
    // fails at runtime in a consumer's install; this gate reads every manifest
    // and requires one shared floor, so the drift cannot land.
    expect([...new Set(manifests.map((file) => json<PackageJson>(file).engines.node))]).toHaveLength(1)
  })

  it('floors the Node types at the version the manifests require', () => {
    // `engines` is the floor a consumer is told to meet; `@types/node` is the
    // API surface `tsc` checks against. Types older than the floor check
    // against an API the manifest does not demand, and newer ones against APIs
    // that floor does not have. They are one number, so the gate reads it once
    // and requires the other to match rather than pinning both.
    const floor = /\^(\d+\.\d+\.\d+)/u.exec(json<PackageJson>('package.json').engines.node)?.[1]
    expect(floor).toMatch(/^\d+\.\d+\.\d+$/)
    expect(json<PackageJson>('package.json').devDependencies['@types/node']).toBe(`^${String(floor)}`)
  })
})

describe('type checking cannot be skipped', () => {
  it.each([
    // `ignoreDeprecations` silences a deprecation rather than acting on it,
    // which is a suppression comment in configuration form. `baseUrl` is the
    // deprecation it would have silenced here: it stops functioning in
    // TypeScript 7, and `paths` resolves relative to this file without it.
    ['ignoreDeprecations', undefined],
    ['baseUrl', undefined],
    ['strict', true],
    ['skipLibCheck', false],
    ['noUncheckedIndexedAccess', true],
    ['exactOptionalPropertyTypes', true],
  ])('%s is %s', (option, value) => {
    expect(json<TsConfigBase>('tsconfig.base.json').compilerOptions[option]).toBe(value)
  })
})

describe('nothing is hidden from the unused-code gate', () => {
  it('scans the root workspace as well as the packages', () => {
    expect(json<KnipConfig>('knip.json').workspaces['.']?.project).toEqual([
      '*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
    ])
  })

  it('gives every workspace a project scope', () => {
    const { workspaces } = json<KnipConfig>('knip.json')
    expect(Object.entries(workspaces).filter(([, ws]) => (ws.project ?? []).length === 0)).toEqual([])
  })

  it('hides nothing behind an ignore list', () => {
    // An `ignore` or `ignoreDependencies` key would silently exempt code from
    // the unused-code gate, which is the same shape as a mutate exclusion.
    const { workspaces } = json<KnipConfig>('knip.json')
    const hiding = Object.entries(workspaces).filter(
      ([, ws]) => ws.ignore !== undefined || ws.ignoreDependencies !== undefined,
    )
    expect(hiding).toEqual([])
  })
})

describe('nothing is hidden from the type checker', () => {
  it.each([
    'tests/**/*.ts',
    'scripts/**/*.ts',
    'packages/*/tsdown.config.ts',
    'packages/*/src/**/*.ts',
    'packages/*/tests/**/*.ts',
  ])('%s is typechecked', (pattern) => {
    // This suite polices every other gate, and until these patterns existed it
    // was not itself typechecked — eight real type errors were hiding in it.
    expect(json<TsConfig>('tsconfig.json').include).toContain(pattern)
  })
})

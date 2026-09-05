/**
 * The quality rules, as a gate rather than as prose.
 *
 * Every rule the README states is asserted here. A rule that is only documented
 * holds until someone edits a config, and nothing goes red when they do — so
 * the rules fail a build instead of describing an intention.
 *
 * The suppression and evasion needles are assembled from fragments so this file
 * does not contain the text it forbids, and therefore needs no exemption for
 * itself.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Every tracked file, so untracked scratch work cannot fail the gate. */
const tracked = execFileSync('git', ['ls-files'], { cwd: root('..'), encoding: 'utf8' })
  .split('\n')
  .filter((line) => line !== '')

const read = (file: string): string => readFileSync(root(`../${file}`), 'utf8')
const json = <T>(file: string): T => JSON.parse(read(file)) as T

/** The gate configuration this suite polices, typed so a missing key is an error. */
interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
}
interface OxfmtConfig {
  readonly ignorePatterns?: readonly string[]
  readonly overrides?: readonly unknown[]
}
interface StrykerConfig {
  readonly mutate: readonly string[]
  readonly thresholds: Readonly<Record<string, number>>
}
interface OxlintConfig {
  readonly categories: Readonly<Record<string, string>>
}
interface TsConfigBase {
  readonly compilerOptions: Readonly<Record<string, unknown>>
}
interface TsConfig {
  readonly include: readonly string[]
}
interface KnipWorkspace {
  readonly project?: readonly string[]
  readonly entry?: readonly string[]
  readonly ignore?: readonly string[]
  readonly ignoreDependencies?: readonly string[]
}
interface KnipConfig {
  readonly workspaces: Readonly<Record<string, KnipWorkspace>>
}

const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))
/**
 * Every file under a tests directory, not only `*.test.ts`.
 *
 * A helper is exactly where an evasion would hide: a shared harness or an axe
 * wrapper with a rule-disabling default is invisible to a scan that only looks
 * at files whose name ends in `.test.ts`.
 */
const tests = code.filter((file) => /(^|\/)tests\//.test(file))
const sources = code.filter((file) => /^packages\/[^/]+\/src\//.test(file))

/** Files containing a needle, so a failure names them. */
const containing = (files: readonly string[], needle: string): string[] =>
  files.filter((file) => read(file).includes(needle))

describe('no suppression comments', () => {
  it.each([
    ['eslint', `eslint-dis${'able'}`],
    ['oxlint', `oxlint-dis${'able'}`],
    ['ts-ignore', `@ts-ig${'nore'}`],
    ['ts-expect-error', `@ts-exp${'ect-error'}`],
    ['ts-nocheck', `@ts-noc${'heck'}`],
    ['stryker', `Stryker dis${'able'}`],
  ])('no %s suppression exists in tracked code', (_label, needle) => {
    expect(containing(code, needle)).toEqual([])
  })
})

describe('no test evasions', () => {
  it.each([
    ['skip', `.sk${'ip('}`],
    ['only', `.on${'ly('}`],
    ['todo', `.to${'do('}`],
    ['conditional skip', `skip${'If('}`],
    ['conditional run', `run${'If('}`],
    ['soft assertion', `expect.so${'ft'}`],
    // A throw assertion with no argument passes for any error at all — a network
    // failure, a typo in a fixture — so it proves only that something went wrong.
    ['bare throw assertion', `toThrow${'()'}`],
    ['bare throw-error assertion', `toThrowError${'()'}`],
    // `getBy*` already throws when nothing matches, so a defined-only check on
    // its result asserts nothing — and passes for `null` the moment the query
    // becomes `queryBy*`.
    ['defined-only assertion', `.toBeDefi${'ned()'}`],
    ['truthy assertion', `.toBeTru${'thy()'}`],
    ['falsy assertion', `.toBeFal${'sy()'}`],
    ['anything matcher', `expect.anyt${'hing()'}`],
    // A rejection caught and discarded leaves the outcome the test exists to
    // observe unobserved.
    ['swallowed rejection', `.cat${'ch(() =>'}`],
  ])('no %s appears in a test file', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })
})

describe('tests speak in user-visible copy', () => {
  it('never imports the locale, so an assertion cannot compare a string with itself', () => {
    // A test that reads `en.cost.empty` and looks for `en.cost.empty` passes
    // whatever the copy says. Pinning the literal is what makes copy a contract.
    expect(containing(tests, `locales/${'en'}`)).toEqual([])
  })
})

/**
 * Budget for a test that launches a whole vitest collection as a subprocess.
 *
 * Collecting 1,000+ tests takes a few seconds locally and over ten on a
 * two-core CI runner, which is beyond the default; the bound is still finite,
 * so a hung collection fails rather than waits forever.
 */
const COLLECTION_TIMEOUT_MS = 120_000

describe('every test is uniquely addressable', () => {
  it(
    'gives no two tests the same full name, which per-test mutation filtering selects by',
    { timeout: COLLECTION_TIMEOUT_MS },
    () => {
      // Asked of vitest itself rather than parsed from source, so `it.each`
      // expansions and nested describes are seen exactly as the runner sees them.
      // A duplicate name has twice made a mutant that tests kill report as
      // surviving, because the filter could not address the test that killed it.
      const listed = JSON.parse(
        execFileSync('bunx', ['vitest', 'list', '--config', 'vitest.config.ts', '--json'], {
          cwd: root('..'),
          encoding: 'utf8',
          // A vitest run inherits the outer worker's environment; the listing must
          // not believe it is one of this run's workers.
          env: {
            ...process.env,
            VITEST: undefined,
            VITEST_MODE: undefined,
            VITEST_POOL_ID: undefined,
            VITEST_WORKER_ID: undefined,
          },
        }),
      ) as readonly { readonly name: string; readonly file: string }[]
      const counts = new Map<string, number>()
      for (const test of listed) {
        const key = `${relative(root('..'), test.file)} > ${test.name}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      expect([...counts].filter(([, n]) => n > 1).map(([key]) => key)).toEqual([])
    },
  )
})

describe('no type escape hatch in source', () => {
  it.each([
    ['double cast', `as unk${'nown as'}`],
    ['explicit any', `: a${'ny'}`],
    ['any cast', `as a${'ny'}`],
  ])('no %s appears under src', (_label, needle) => {
    expect(containing(sources, needle)).toEqual([])
  })
})

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
    // whole file: 47 mutants, ten of them untested.
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

describe('type checking cannot be skipped', () => {
  it.each([
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

describe('accessibility cannot be filtered', () => {
  it.each([
    ['tag scope', `with${'Tags('}`],
    ['rule narrowing', `with${'Rules('}`],
    ['rule disabling', `disable${'Rules('}`],
    ['selector exclusion', `.exc${'lude('}`],
    ['inline rule overrides', `rul${'es: {'}`],
  ])('no %s is used in any test', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })

  it('scans every surface with the whole rule set', () => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(
      'new AxeBuilder({ page }).analyze()',
    )
  })

  it('runs the browser lane rather than leaving those tests unrun', () => {
    expect(read('vitest.a11y.config.ts')).toContain("include: ['packages/*/tests/**/*.browser.test.tsx']")
    expect(read('.github/workflows/ci.yml')).toContain('bun run test:a11y')
  })
})

describe('every gate runs in CI', () => {
  it.each([
    'bun run typecheck',
    'bun run lint',
    'bun run format:check',
    'bun run test:coverage',
    'bun run test:invariants',
    'bun run test:dist',
    'bun run test:a11y',
    'bun run stryker',
    'bun run knip',
  ])('%s', (command) => {
    expect(read('.github/workflows/ci.yml')).toContain(command)
  })
})

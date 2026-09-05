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
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Every tracked file, so untracked scratch work cannot fail the gate. */
const tracked = execFileSync('git', ['ls-files'], { cwd: root('..'), encoding: 'utf8' })
  .split('\n')
  .filter((line) => line !== '')

const read = (file: string): string => readFileSync(root(`../${file}`), 'utf8')
const json = (file: string): Record<string, never> => JSON.parse(read(file)) as Record<string, never>

const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))
const tests = code.filter((file) => /\.test\.tsx?$/.test(file))
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
  ])('no %s appears in a test file', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })
})

describe('mutation testing cannot be narrowed', () => {
  it('mutates every source extension, with no negated pattern', () => {
    expect(json('stryker.config.json').mutate).toEqual([
      'packages/*/src/**/*.ts',
      'packages/*/src/**/*.tsx',
    ])
  })

  it('fails the run below a perfect score', () => {
    expect(json('stryker.config.json').thresholds).toEqual({ high: 100, low: 100, break: 100 })
  })

  it('runs the escape guard after the mutation run', () => {
    expect(json('package.json').scripts.stryker).toBe(
      'stryker run && node scripts/verify-mutation-files.mjs',
    )
  })

  it('has no const assertion in source, which would remove values from mutation', () => {
    // Stryker does not mutate inside a const assertion. One of these once hid a
    // whole file: 47 mutants, ten of them untested.
    expect(containing(sources, 'as const')).toEqual([])
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

  it('measures every source extension', () => {
    expect(read('vitest.config.ts')).toContain(
      "include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx']",
    )
  })
})

describe('linting cannot be softened', () => {
  it('grades every enabled category as an error', () => {
    const categories: Record<string, string> = json('.oxlintrc.json').categories
    expect(Object.entries(categories).filter(([, level]) => level !== 'error')).toEqual([])
  })

  it('fails the build on a warning', () => {
    expect(json('package.json').scripts.lint).toContain('--deny-warnings')
  })
})

describe('type checking cannot be skipped', () => {
  it.each([
    ['strict', true],
    ['skipLibCheck', false],
    ['noUncheckedIndexedAccess', true],
    ['exactOptionalPropertyTypes', true],
  ])('%s is %s', (option, value) => {
    expect(json('tsconfig.base.json').compilerOptions[option]).toBe(value)
  })
})

describe('nothing is hidden from the unused-code gate', () => {
  it('scans the root workspace as well as the packages', () => {
    expect(json('knip.json').workspaces['.'].project).toEqual(['*.ts', 'tests/**/*.ts'])
  })
})

describe('accessibility cannot be filtered', () => {
  it.each([
    ['tag scope', `with${'Tags('}`],
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

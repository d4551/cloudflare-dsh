/**
 * The tree the gates scan, and the needles no scan may find.
 *
 * The gate modules beside `tests/gates/` assert every rule the README states.
 * This file holds what they share a stake in: the file lists every scan starts
 * from — each guarded against going empty — and the suppression and evasion
 * needles, which fail a build instead of describing an intention.
 *
 * The needles are assembled from fragments so this file does not contain the
 * text it forbids, and therefore needs no exemption for itself.
 */
import { describe, expect, it } from 'vitest'
import { code, containing, matching, read, sources, tests, tracked } from './gates/support.ts'

describe('the lists every scan in this suite starts from', () => {
  /**
   * Each list, and files it must contain.
   *
   * Emptying one of these turns every scan below it into an assertion that an
   * empty list contains nothing. Measured before this existed: replacing `code`
   * with an empty list left 244 of the 247 tests in this suite passing, and the
   * three that failed were the only ones carrying a guard of their own.
   *
   * A floor would drift with the tree. Naming files each list must contain
   * proves it is populated and that its filter still matches the shape the list
   * is named for — a `sources` that stopped matching `src` would be empty, and
   * a `tests` that stopped seeing helpers would be missing `axe.ts`.
   */
  const ROOTS: ReadonlyArray<{ name: string; list: readonly string[]; required: readonly string[] }> = [
    {
      name: 'tracked',
      list: tracked,
      required: ['package.json', '.gitignore', 'README.md', 'packages/client/src/cloudflare.css'],
    },
    {
      name: 'code',
      list: code,
      required: ['package.json', 'vitest.config.ts', '.github/workflows/ci.yml', 'knip.json'],
    },
    {
      name: 'tests',
      list: tests,
      required: [
        'tests/invariants.test.ts',
        'tests/gates/support.ts',
        'packages/client/tests/axe.ts',
        'packages/bundle/tests/patch.test.ts',
      ],
    },
    {
      name: 'sources',
      list: sources,
      required: ['packages/core/src/index.ts', 'packages/bundle/src/seam.ts', 'packages/client/src/index.ts'],
    },
    {
      name: 'modules',
      list: code.filter((file) => /\.tsx?$/.test(file)),
      required: [
        'vitest.a11y.config.ts',
        'scripts/verify-mutation-files.ts',
        'packages/client/src/toolviews/fromToolCall.tsx',
      ],
    },
  ]

  it('carries the files each list is named for', () => {
    // One labelled expectation per list: a failure names the list whose filter
    // stopped matching, which is the same report a generated case would give.
    for (const { name, list, required } of ROOTS) {
      expect(required.filter((file) => !list.includes(file)), name).toEqual([])
    }
  })
})

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
    // failure, a typo in a fixture — so it checks only that something went wrong.
    ['bare throw assertion', `toThrow${'()'}`],
    ['bare throw-error assertion', `toThrowError${'()'}`],
    // `getBy*` already throws when nothing matches, so a defined-only check on
    // its result carries no information the query lacks — and it holds for
    // `null` the moment the query becomes `queryBy*`.
    ['defined-only assertion', `.toBeDefi${'ned()'}`],
    ['truthy assertion', `.toBeTru${'thy()'}`],
    ['falsy assertion', `.toBeFal${'sy()'}`],
    ['anything matcher', `expect.anyt${'hing()'}`],
    // A rejection caught and discarded leaves the outcome the test exists to
    // observe unobserved.
    ['swallowed rejection', `.cat${'ch(() =>'}`],
    ['snapshot', `toMatch${'Snapshot('}`],
    ['inline snapshot', `toMatchInline${'Snapshot('}`],
    ['file snapshot', `toMatchFile${'Snapshot('}`],
    // Every string contains the empty string, so this matcher holds for every
    // string — the anything-matcher above under another name.
    ['empty substring matcher', `stringContaining(${"''"})`],
    // A clock in a test makes the result depend on how loaded the machine is.
    // Source modules are already held to this; a test asserting on elapsed
    // wall time was how it got in.
    ['wall clock', `Date.${'now('}`],
    ['clock construction', `new Da${'te('}`],
    ['performance clock', `performance.${'now('}`],
  ])('no %s appears in a test file', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })
})

describe('no assertion that anything at all satisfies', () => {
  it('never asserts merely that a query returned an element', () => {
    // `getBy*` throws when nothing matches, so asserting that its result is an
    // element carries no information the query lacks — and it holds for every
    // element on the page, so a query aimed at the wrong node still reads as
    // wired. This is the defined-only assertion above under another name, and
    // it was here 23 times. Matched as a pattern because the formatter wraps
    // the long ones.
    expect(matching(tests, new RegExp(`toBeInstance${'Of'}\\(\\s*HTML`, 'u'))).toEqual([])
  })
})

describe('the gates read the tree they police', () => {
  it('parses every module the escape-hatch gate walks', () => {
    // The gate modules parse with oxc-parser; a module whose syntax that
    // parser rejects would fail the gate with a parse error rather than pass
    // silently, which this pins by naming the parser's own entry point.
    expect(read('tests/gates/scan.ts')).toContain('parseSync')
  })
})

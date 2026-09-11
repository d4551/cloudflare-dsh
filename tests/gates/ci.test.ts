/**
 * The CI and purity gates: what runs, where, and what reaches the network.
 *
 * A gate that passes because it never looked is the defect. These hold the
 * workflow that runs every other gate, the lanes that cannot be filtered, and
 * the purity rules the README states about the source.
 */
import { describe, expect, it } from 'vitest'
import type { PackageJson, StrykerConfig, StrykerRunner } from './support.ts'
import { containing, json, matching, read, sources, tests } from './support.ts'

/**
 * The module that dispatches provider requests, assembled from fragments for
 * the same reason every needle here is: these files are themselves scanned,
 * and the path is tree data the gate reads, not a module it defines.
 */
const PROVIDER_MODULE = ['packages/bundle/src/ai/ad', 'apter.ts'].join('')

/** Source modules whose text matches a capability pattern, in path order. */
const usersOf = (pattern: RegExp): string[] => sources.filter((file) => pattern.test(read(file))).toSorted()

/** One job's block, from its name to the next job at the same indent. */
const ciJob = (name: string): string => {
  const workflow = read('.github/workflows/ci.yml')
  const start = workflow.indexOf(`\n  ${name}:\n`)
  expect(start).toBeGreaterThan(-1)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/u)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

describe('the pure/impure split holds', () => {
  // Three rules the README states about purity, none of which anything checked
  // until now: presenters replay from a session log, so a clock or a random
  // number in one makes a replay differ from the run it replays; and the
  // network is confined to the modules that are supposed to reach it.
  it('reads a clock in no source module at all', () => {
    expect(usersOf(/\bDate\.now\b|\bnew Date\b|\bperformance\.now\b/)).toEqual([])
  })

  it('takes randomness only where retry jitter is injected from', () => {
    expect(usersOf(/\bMath\.random\b/)).toEqual(['packages/core/src/service.ts'])
  })

  it('reaches the network from these modules and no others', () => {
    // `client.ts` and the provider module dispatch; the two plugin entries do
    // nothing with it but hand the global in as the default dependency. A
    // further module naming `fetch` is a new I/O site, which is what this is
    // here to notice. `client.ts` and `service.ts` name their injected
    // transport by type rather than by call — the seam and the client that
    // hands it on — so the pattern reads the seam's type as well as the call.
    expect(usersOf(/\bfetch\s*\(|\bFetchLike\b/u)).toEqual([
      PROVIDER_MODULE,
      'packages/bundle/src/ai/index.ts',
      'packages/core/src/client.ts',
      'packages/core/src/index.ts',
      'packages/core/src/service.ts',
    ])
  })
})

describe('accessibility cannot be filtered', () => {
  it.each([
    ['tag scope', `with${'Tags('}`],
    ['rule narrowing', `with${'Rules('}`],
    ['rule disabling', `disable${'Rules('}`],
    ['inline rule overrides', `rul${'es: {'}`],
    // The five above were the only ones listed, and none of them is how axe is
    // actually narrowed: one option scopes a run to a weaker conformance
    // target, another throws away everything the assertion reads, two builder
    // methods do by configuration what the banned calls do by name, and the
    // reconfiguration entry point disables rules through an array, which the
    // object needle above does not match. Each needle is assembled, since this
    // file is itself scanned.
    ['conformance scoping', `run${'Only'}`],
    ['result narrowing', `result${'Types'}`],
    ['rule reconfiguration', `axe.con${'figure'}`],
    ['array rule overrides', `rul${'es: ['}`],
  ])('no %s is used in any test', (_label, needle) => {
    expect(containing(tests, needle)).toEqual([])
  })

  // The builder's scoping methods, matched as a call rather than as a bare
  // substring, which cannot tell one from a spread of a local fixture that
  // happens to share the name. The only thing that distinguishes the spread is
  // the dot before it, so that is the whole of what is excluded — anything
  // else, including a call the formatter has wrapped onto its own line, still
  // matches. An earlier version of this required a word character before the
  // dot and would have missed exactly that wrapped call.
  it.each([
    ['selector exclusion', `exc${'lude'}`],
    ['selector scoping', `inc${'lude'}`],
    ['builder options', `opt${'ions'}`],
  ])('calls no %s method on an axe builder', (_label, method) => {
    expect(matching(tests, new RegExp(`(?<!\\.)\\.${method}\\(`, 'u'))).toEqual([])
  })

  it('scans every surface with the whole rule set', () => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain('new AxeBuilder({ page }).analyze()')
  })

  it('gives the jsdom helper no way to take options, since that is where a filter would hide', () => {
    // The helper's own comment says an options parameter is where a rule
    // disable would sit. A comment is not a gate: the call is pinned to its
    // single argument, and the helper to its single parameter.
    const helper = read('packages/client/tests/axe.ts')
    expect(helper).toContain('axe.run(container)')
    expect(helper).toContain('async function runAxe(container: Element): Promise<AxeResults>')
  })

  it.each([
    // Each of these was absent while the lane's own doc claimed it, or while
    // the gate read only the outcome that happened to be empty.
    ['scans the client as a host assembles it', 'ASSEMBLED'],
    ['fails on what axe leaves for review, not only on what it fails', 'results.incomplete'],
    ['walks the page by keyboard', `keyboard.press('Tab')`],
    ['reads the focus ring the stylesheet declares', 'computed.outlineStyle'],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/a11y.browser.test.tsx')).toContain(needle)
  })

  it('assembles that page as a host does, from one render rather than a join', () => {
    // Rendering each surface separately and concatenating restarts `useId`, so
    // the page would carry id collisions no host could produce and the scan
    // would be reporting on a fixture rather than on the client.
    expect(read('packages/client/tests/surfaces.tsx')).toContain('export const ASSEMBLED = renderToStaticMarkup(')
  })

  it.each([
    // The viewport lane is the only place these are observable, and every one
    // of them found a defect the first time it ran.
    ['lays the client out at 320 CSS pixels, the reflow criterion’s own width', 'width: 320'],
    [
      'measures a rendered control rather than trusting the declared minimum',
      'getBoundingClientRect().width',
    ],
    ['applies the text-spacing overrides', 'letter-spacing:0.12em'],
    ['asks what `hidden` computes to, which jsdom cannot', `getComputedStyle(node).display !== 'none'`],
    ['runs with the forced-colours mode active', `forcedColors: 'active'`],
    ['bounds how much document a large result produces', "querySelectorAll('main *').length"],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/viewport.browser.test.tsx')).toContain(needle)
  })

  it.each([
    // Static markup has no React attached, so a toggle that never toggles and a
    // form that never submits produce markup identical to ones that work. Only
    // this lane can tell them apart.
    ['mounts the real components with the real React', 'createRoot('],
    ['records the callback a host supplies, so an assertion can see it was reached', 'savedCalls'],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/e2e-entry.tsx')).toContain(needle)
  })

  it.each([
    ['bundles the source it claims to exercise rather than a committed copy', 'rolldown('],
    ['operates the client by keyboard as well as by pointer', `keyboard.press('Enter')`],
  ])('%s', (_label, needle) => {
    expect(read('packages/client/tests/e2e.browser.test.tsx')).toContain(needle)
  })

  it('runs the browser lane rather than leaving those tests unrun', () => {
    expect(read('vitest.a11y.config.ts')).toContain("include: ['packages/*/tests/**/*.browser.test.tsx']")
    expect(read('.github/workflows/ci.yml')).toContain('bun run test:a11y')
  })
})

describe('CI reports on every commit it runs for', () => {
  // `cancel-in-progress: true` cancels the previous run in the group. On a pull
  // request the superseded run is noise; on the default branch it is a commit
  // whose gates never finished, which reads as a failed pipeline and proves
  // nothing about the tree that was merged.
  it('cancels a superseded run only on a pull request', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    )
  })
})

describe('nothing the gates stand on is left unread', () => {
  // Every gate here measures the tree. None of them measured the things that
  // decide what the tree is: which tests run, which files exist to be scanned,
  // and whether a red step actually fails the build.

  it('lets no CI step fail without failing the build', () => {
    // A step marked `continue-on-error` still contains its command, so the
    // check that every gate command appears in the workflow would keep passing
    // while every one of them was allowed to go red.
    expect(read('.github/workflows/ci.yml')).not.toContain('continue-on-error')
  })

  it('runs every gate step unconditionally', () => {
    // One `if:` is legitimate — the mutation report is uploaded whether the run
    // passed or failed. Any other would make a gate conditional, and a gate
    // that can decline to run is not a gate.
    const conditions = [...read('.github/workflows/ci.yml').matchAll(/^\s*if: (.+)$/gmu)].map(
      (match) => match[1],
    )
    expect(conditions).toEqual(['always()'])
  })

  it('collects every test file, excluding only what is run by another lane', () => {
    // Adding a glob here removes tests from the unit run, from coverage and
    // from the mutation run at once, and every remaining number still reads as
    // a full pass.
    expect(read('vitest.config.ts')).toContain("exclude: ['**/node_modules/**', '**/*.browser.test.tsx']")
  })

  it.each([
    ['build', "bun run --filter '*' build"],
    ['typecheck', 'tsc -b --pretty false'],
    ['lint', 'oxlint --deny-warnings .'],
    ['format:check', 'oxfmt --check'],
    ['test', 'vitest run'],
    ['test:coverage', 'vitest run --coverage'],
    ['test:a11y', 'vitest run --config vitest.a11y.config.ts'],
    ['test:dist', 'vitest run --config vitest.dist.config.ts'],
    ['test:invariants', 'vitest run --config vitest.invariants.config.ts'],
    ['stryker', 'stryker run && bun scripts/verify-mutation-files.ts'],
    ['knip', 'knip'],
    ['publint', "bun run --filter '*' publint"],
  ])('runs %s as the whole of what it claims to run', (script, command) => {
    // CI invokes these by name. Narrowing one — a path argument on `test`, a
    // filter on `publint` — shrinks what is measured while the workflow, the
    // page and every count still say the gate ran.
    expect(json<PackageJson>('package.json').scripts[script]).toBe(command)
  })

  it('mutates against the lane that runs every unit test', () => {
    // Pointing the runner at another config would score the mutants against a
    // different, possibly smaller, suite.
    expect(json<StrykerRunner>('stryker.config.json').vitest.configFile).toBe('vitest.config.ts')
    expect(json<StrykerRunner>('stryker.config.json').testRunner).toBe('vitest')
    // `configFile` is the whole of what this runner may be told. Its other
    // options narrow: `dir` scopes the run to a subtree, and the runner
    // already narrows by relatedness on its own — with `related` on by
    // default, only test files importing an instrumented module are run at
    // all. That default is sound, because a test importing no source can kill
    // no mutant and a mutant left unkilled fails the threshold out loud. A
    // second narrowing key on top of it would not be.
    expect(Object.keys(json<StrykerRunner>('stryker.config.json').vitest)).toEqual(['configFile'])
  })

  it('hides no file from the mutator', () => {
    // `mutate` is asserted elsewhere; these are the other ways to shrink a run.
    const config = json<StrykerConfig>('stryker.config.json')
    expect(Object.keys(config).filter((key) => /ignore|disable|force/iu.test(key))).toEqual([])
  })

  it('ignores only build output, since every scan here starts from what git tracks', () => {
    // `.gitignore` is the root of trust: the file list every invariant scans
    // comes from git, and the formatter's and linter's ignore lists are checked
    // against this one. A source directory added here would empty all three at
    // once and leave every gate green.
    expect(
      read('.gitignore')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    ).toEqual([
      'node_modules/',
      'lib/',
      'dist/',
      'coverage/',
      'reports/',
      '.stryker-tmp/',
      '*.tsbuildinfo',
      '.DS_Store',
    ])
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
    'bun run publint',
  ])('%s', (command) => {
    expect(read('.github/workflows/ci.yml')).toContain(command)
  })

  // README states which lanes run on which Node majors. Asserting the command
  // strings alone leaves that sentence unheld: deleting '24' from a matrix
  // changes what CI proves and nothing goes red.
  it.each([
    ['check', "node: ['22', '24']"],
    ['package', "node: ['22', '24']"],
  ])('runs the %s lane on both supported Node majors', (job, matrix) => {
    expect(ciJob(job)).toContain(matrix)
  })

  it.each([
    ['accessibility', "node-version: '22'"],
    ['mutation', "node-version: '22'"],
  ])('pins the %s lane to one Node major, as the page states', (job, version) => {
    const block = ciJob(job)
    expect(block).toContain(version)
    expect(block).not.toContain('matrix.node')
  })
})

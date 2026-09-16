/**
 * The CI and purity gates: what runs, where, and what reaches the network.
 *
 * A gate that passes because it never looked is the defect. These hold the
 * workflow that runs every other gate, the lanes that cannot be filtered, and
 * the purity rules the README states about the source.
 *
 * The accessibility-invocation rules that used to be a second copy here live in
 * `axe-lanes.test.ts`, which is where the lane that cannot narrow itself
 * belongs; the two copies asserted the same twenty facts about the same files.
 */
import { describe, expect, it } from 'vitest'
import { json, read } from './base.ts'
import type { PackageJson, StrykerConfig, StrykerRunner } from './repo.ts'
import { codeUses } from './scanners.ts'
import { sources } from './support.ts'

/**
 * The capability the network is reached through, in both of its spellings: the
 * platform's own `fetch` and the `FetchLike` type the client declares for the
 * transport injected in its place.
 *
 * A bare reference to the global counts as much as a call: handing `fetch` to
 * an injected transport is the network reaching the module just as much as
 * calling it. The pattern was once `\bfetch\s*\(`, which read the call and read
 * right past `transmit: fetch` — the bundle's one I/O wiring — so the list it
 * "proved" was shorter than the truth. Widening it to a bare word then named
 * four modules that reach nothing: a doc line about what `fetch` would do, a
 * description string asking which body to fetch, and a Chrome resource type
 * spelled `'fetch'`. The scanner reads code, so both faults are gone.
 */
const NETWORK = /\bfetch\b|\bFetchLike\b/u

/**
 * Source modules whose code names a capability, in path order.
 *
 * Prose is not code: a comment saying a module never calls a clock, or a string
 * that happens to contain the word, is not a site for the capability. A further
 * module naming one in code is, which is what these gates exist to notice.
 */
const usersOf = (pattern: RegExp): string[] =>
  sources.filter((file) => codeUses(file, read(file), pattern).length > 0).toSorted()

/** One job's block, from its name to the next job at the same indent. */
const ciJob = (name: string): string => {
  const workflow = read('.github/workflows/ci.yml')
  const start = workflow.indexOf(`\n  ${name}:\n`)
  expect(start).toBeGreaterThan(-1)
  const rest = workflow.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}\w[\w-]*:\n/u)
  return next === -1 ? rest : rest.slice(0, next + 1)
}

/** One module that reaches the network, and the code in it that says so. */
interface NetworkReach {
  readonly module: string
  readonly code: string
}

/**
 * Every source module that reaches the network, and the line in it that does.
 *
 * Each row was read in the module it names: the bundle's provider entry hands
 * the platform function in as the transport, the client declares the transport
 * type and holds one, the package entry passes the global through, and the
 * service takes that transport as a dependency. The `code` column is what makes
 * a row checkable rather than asserted — it is searched for in the module's
 * code, so a row citing a comment or a string finds nothing.
 */
const NETWORK_REACH: readonly NetworkReach[] = [
  { module: 'packages/bundle/src/ai/index.ts', code: 'transmit: fetch' },
  { module: 'packages/core/src/client.ts', code: 'export type FetchLike = ' },
  { module: 'packages/core/src/index.ts', code: 'fetch,' },
  { module: 'packages/core/src/service.ts', code: 'readonly fetch: FetchLike' },
]

/** A pattern matching one code snippet literally, so a row can be searched for. */
const literal = (snippet: string): RegExp =>
  new RegExp(snippet.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u')

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
    expect(usersOf(NETWORK)).toEqual(NETWORK_REACH.map((row) => row.module))
  })

  it('reaches it through the code each of those modules is named for', () => {
    // One labelled expectation per row, so a failure names the module whose
    // cite went stale. The cite is code rather than prose or a string, which is
    // what the scanner exists to tell apart: a row naming a comment finds
    // nothing here.
    for (const { module, code } of NETWORK_REACH) {
      expect(codeUses(module, read(module), literal(code)), module).not.toEqual([])
    }
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
    // once and leave every gate green. The Playwright browser download the
    // a11y lane needs is provisioned outside the workspace (a per-run cache
    // path), so nothing third-party enters the tree this gate polices.
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

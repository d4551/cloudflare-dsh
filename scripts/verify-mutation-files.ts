/**
 * Fails unless the mutation report describes this exact tree and every source
 * file with runtime code was mutated.
 *
 * The checks live in `mutation-guard.ts`, where they are unit-tested; this file
 * gathers the tree, applies them in order, and prints what failed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  type MutationReport,
  escapedFiles,
  rewrittenFiles,
  staleInputs,
  unloadableMutants,
} from './mutation-guard.ts'

const REPORT = 'reports/mutation/mutation.json'
const PACKAGES = readdirSync('packages')
const ROOTS = PACKAGES.map((pkg) => join('packages', pkg, 'src'))

/**
 * Everything else the run's outcome depends on.
 *
 * A mutant is killed or survives according to the tests and the configuration
 * the run saw, not only the sources it mutated. A test weakened after the run
 * — or a config that changed which tests execute — leaves the report describing
 * a tree that no longer exists, exactly as an edited source would.
 */
const TEST_ROOTS = PACKAGES.map((pkg) => join('packages', pkg, 'tests'))
const RUN_CONFIG = [
  'vitest.config.ts',
  'stryker.config.json',
  'package.json',
  'bun.lock',
  'tsconfig.json',
  'tsconfig.base.json',
  ...PACKAGES.flatMap((pkg) => [
    join('packages', pkg, 'package.json'),
    join('packages', pkg, 'tsconfig.json'),
  ]),
].filter((path) => existsSync(path))

/** Every file under a directory. */
function files(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...files(path))
    else out.push(path)
  }
  return out
}

/** Every `.ts`/`.tsx` file under the mutated roots. */
const sources = (dir: string): string[] => files(dir).filter((path) => /\.tsx?$/.test(path))

function fail(finding: string, remedy: string): never {
  console.error(finding)
  console.error(remedy)
  process.exit(1)
}

const reportedAt = statSync(REPORT).mtimeMs
const inputs = [...ROOTS.flatMap(sources), ...TEST_ROOTS.filter(existsSync).flatMap(files), ...RUN_CONFIG]
const stale = staleInputs(
  inputs.map((path) => ({ path, mtimeMs: statSync(path).mtimeMs })),
  reportedAt,
)
if (stale.length > 0) {
  fail(
    `The mutation report predates these inputs, so it does not describe this tree:\n  ${stale.join('\n  ')}`,
    'Re-run `bun run stryker`.',
  )
}

// Stryker records absolute paths; the tree is addressed relative to its root.
const raw = JSON.parse(readFileSync(REPORT, 'utf8')) as MutationReport
const report: MutationReport = {
  files: Object.fromEntries(Object.entries(raw.files).map(([file, entry]) => [relative('.', file), entry])),
}

const rewritten = rewrittenFiles(report, (path) =>
  existsSync(path) ? readFileSync(path, 'utf8') : undefined,
)
if (rewritten.length > 0) {
  fail(
    `The mutation report was made from different text for these files, so it does not describe this tree:\n  ${rewritten.join('\n  ')}`,
    'Re-run `bun run stryker`.',
  )
}

const unloadable = unloadableMutants(report)
if (unloadable.length > 0) {
  fail(
    `These mutants ran no tests at all, so "survived" means the mutated module failed to load:\n  ${unloadable.join('\n  ')}`,
    'Restructure the code so the mutation is observable by a test, then re-run.',
  )
}

const escaped = escapedFiles(report, ROOTS.flatMap(sources), (path) => readFileSync(path, 'utf8'))
if (escaped.length > 0) {
  fail(
    `These files emit JavaScript but produced no mutants:\n  ${escaped.join('\n  ')}`,
    'A file with runtime code must be mutated. Look for a `const` assertion around it.',
  )
}
console.log(
  `Every source file with runtime code was mutated (${Object.keys(report.files).length} instrumented).`,
)

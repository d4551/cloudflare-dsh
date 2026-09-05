/**
 * Fails if a source file escaped mutation.
 *
 * Stryker omits a file from its report when it produced no mutants, and a file
 * can produce none for an illegitimate reason: a `const` assertion silently
 * removes everything inside it from mutation, which once hid an entire locale
 * dictionary — 47 mutants, ten of them untested — behind a report that read as
 * complete.
 *
 * The only legitimate reason is that the file has no runtime code at all. That
 * is decided here by transpiling it and looking at what is left, rather than by
 * maintaining a list of files anyone could append to.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/** The subset of Stryker's JSON report this guard reads. */
interface MutantResult {
  readonly status: string
  readonly testsCompleted?: number
  readonly location: { readonly start: { readonly line: number } }
  readonly mutatorName: string
}
interface MutationReport {
  readonly files: Readonly<Record<string, { readonly mutants: readonly MutantResult[] }>>
}

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

/** Whether the file emits no JavaScript once its types are erased. */
function isTypeOnly(path: string): boolean {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  })
  return outputText.replace(/export\s*\{\s*\}\s*;?/g, '').trim() === ''
}

// A report older than the sources it claims to describe proves nothing: it
// would happily validate a tree it never saw. This is not a style check —
// an interrupted run leaves exactly such a file behind.
const reportedAt = statSync(REPORT).mtimeMs
const inputs = [...ROOTS.flatMap(sources), ...TEST_ROOTS.filter(existsSync).flatMap(files), ...RUN_CONFIG]
const stale = inputs.filter((path: string) => statSync(path).mtimeMs > reportedAt)
if (stale.length > 0) {
  console.error(
    `The mutation report predates these inputs, so it does not describe this tree:\n  ${stale.join('\n  ')}`,
  )
  console.error('Re-run `bun run stryker`.')
  process.exit(1)
}

const report = JSON.parse(readFileSync(REPORT, 'utf8')) as MutationReport
const mutated = new Set(Object.keys(report.files).map((f) => relative('.', f)))

// A mutant that breaks a module at import time makes every test file that
// loads it fail before a single test runs. The vitest runner sees zero failing
// tests and an empty error set, and reports the mutant as survived — with no
// tests completed. A real survivor always ran the tests that covered it.
const unloadable = Object.entries(report.files).flatMap(([file, { mutants }]) =>
  mutants
    .filter((mutant) => mutant.status === 'Survived' && (mutant.testsCompleted ?? 0) === 0)
    .map((mutant) => `${relative('.', file)}:${mutant.location.start.line} (${mutant.mutatorName})`),
)
if (unloadable.length > 0) {
  console.error(
    `These mutants ran no tests at all, so "survived" means the mutated module failed to load:\n  ${unloadable.join('\n  ')}`,
  )
  console.error('Restructure the code so the mutation is observable by a test, then re-run.')
  process.exit(1)
}

const escaped = ROOTS.flatMap(sources).filter((path: string) => !mutated.has(path) && !isTypeOnly(path))

if (escaped.length > 0) {
  console.error(`These files emit JavaScript but produced no mutants:\n  ${escaped.join('\n  ')}`)
  console.error('A file with runtime code must be mutated. Look for a `const` assertion around it.')
  process.exit(1)
}
console.log(`Every source file with runtime code was mutated (${mutated.size} instrumented).`)

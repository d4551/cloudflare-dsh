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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/** The subset of Stryker's JSON report this guard reads. */
interface MutationReport {
  readonly files: Readonly<Record<string, unknown>>
}

const REPORT = 'reports/mutation/mutation.json'
const ROOTS = readdirSync('packages').map((pkg) => join('packages', pkg, 'src'))

/** Every `.ts`/`.tsx` file under the mutated roots. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

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
const stale = ROOTS.flatMap(sources).filter((path: string) => statSync(path).mtimeMs > reportedAt)
if (stale.length > 0) {
  console.error(
    `The mutation report predates these sources, so it does not describe this tree:\n  ${stale.join('\n  ')}`,
  )
  console.error('Re-run `bun run stryker`.')
  process.exit(1)
}

const report = JSON.parse(readFileSync(REPORT, 'utf8')) as MutationReport
const mutated = new Set(Object.keys(report.files).map((f) => relative('.', f)))

const escaped = ROOTS.flatMap(sources).filter((path: string) => !mutated.has(path) && !isTypeOnly(path))

if (escaped.length > 0) {
  console.error(`These files emit JavaScript but produced no mutants:\n  ${escaped.join('\n  ')}`)
  console.error('A file with runtime code must be mutated. Look for a `const` assertion around it.')
  process.exit(1)
}
console.log(`Every source file with runtime code was mutated (${mutated.size} instrumented).`)

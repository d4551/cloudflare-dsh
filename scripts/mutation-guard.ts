/**
 * The checks behind `verify-mutation-files.ts`, as pure functions.
 *
 * Each takes what it needs as data, so a test can hand it a synthetic report
 * and watch it fail; the script gathers the tree and prints. A gate nobody has
 * seen fail is not known to work.
 */
import ts from 'typescript'

/** The subset of Stryker's JSON report the guard reads. */
export interface MutantResult {
  readonly status: string
  readonly testsCompleted?: number
  readonly location: { readonly start: { readonly line: number } }
  readonly mutatorName: string
}
export interface ReportFile {
  readonly mutants: readonly MutantResult[]
  /** The text Stryker instrumented, byte for byte. */
  readonly source: string
}
export interface MutationReport {
  readonly files: Readonly<Record<string, ReportFile>>
}

/** One input to the run, with the moment it was last written. */
export interface TimedInput {
  readonly path: string
  readonly mtimeMs: number
}

/**
 * Inputs written after the report was.
 *
 * A mutant is killed or survives according to the sources, the tests and the
 * configuration the run saw. A report older than any of them describes a tree
 * that no longer exists — an interrupted run leaves exactly such a file behind.
 */
export function staleInputs(inputs: readonly TimedInput[], reportedAt: number): string[] {
  return inputs.filter((input) => input.mtimeMs > reportedAt).map((input) => input.path)
}

/**
 * Instrumented files whose text is no longer what the report mutated.
 *
 * Time is not enough: a source edited while the run was in progress is older
 * than the report yet was never instrumented, and reads as fresh. Stryker
 * records the text it mutated, so this compares content. A file that has gone
 * is different too.
 */
export function rewrittenFiles(
  report: MutationReport,
  readSource: (file: string) => string | undefined,
): string[] {
  return Object.entries(report.files)
    .filter(([file, { source }]) => readSource(file) !== source)
    .map(([file]) => file)
}

/**
 * Survivors that ran no tests.
 *
 * A mutant that breaks a module at import time makes every test file that
 * loads it fail before a single test runs. The vitest runner sees zero failing
 * tests and reports the mutant as survived, with no tests completed. A real
 * survivor always ran the tests that covered it.
 */
export function unloadableMutants(report: MutationReport): string[] {
  return Object.entries(report.files).flatMap(([file, { mutants }]) =>
    mutants
      .filter((mutant) => mutant.status === 'Survived' && (mutant.testsCompleted ?? 0) === 0)
      .map((mutant) => `${file}:${mutant.location.start.line} (${mutant.mutatorName})`),
  )
}

/**
 * Whether a module emits no JavaScript once its types are erased — the only
 * legitimate reason for a source file to produce no mutants.
 */
export function isTypeOnly(text: string, fileName: string): boolean {
  const { outputText } = ts.transpileModule(text, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      removeComments: true,
    },
  })
  return outputText.replace(/export\s*\{\s*\}\s*;?/g, '').trim() === ''
}

/**
 * Sources with runtime code that the report never mutated.
 *
 * Stryker omits a file from its report when it produced no mutants, and a file
 * can produce none for an illegitimate reason: a `const` assertion silently
 * removes everything inside it from mutation, which once hid an entire locale
 * dictionary — 47 mutants, ten of them untested — behind a report that read as
 * complete. Whether a file has runtime code is decided by transpiling it, not
 * by a list anyone could append to.
 */
export function escapedFiles(
  report: MutationReport,
  sources: readonly string[],
  readSource: (file: string) => string,
): string[] {
  const mutated = new Set(Object.keys(report.files))
  return sources.filter((path) => !mutated.has(path) && !isTypeOnly(readSource(path), path))
}

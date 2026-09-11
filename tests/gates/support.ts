/**
 * The lists and readers every gate in this suite starts from.
 *
 * Every rule the README states is asserted across the gate modules beside this
 * file. A rule that is only documented holds until someone edits a config, and
 * nothing goes red when they do — so the rules fail a build instead of
 * describing an intention.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * The repository root, anchored at this file's own location two directories up,
 * so every path a gate passes is repository-relative and reads the same from
 * any module in the suite.
 */
const REPO = fileURLToPath(new URL('../../', import.meta.url))

export const root = (path: string): string => `${REPO}${path}`

/**
 * Every file git tracks or would track: a new file that is not yet added is
 * part of the tree CI will see, so it is part of the tree these gates see.
 * Ignored files stay out, so build output cannot fail a gate.
 */
export const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: REPO,
  encoding: 'utf8',
})
  .split('\n')
  .filter((line) => line !== '')

export const read = (file: string): string => readFileSync(root(file), 'utf8')
export const json = <T>(file: string): T => JSON.parse(read(file)) as T

/** The JSON a configuration file parses to, typed so a scan cannot widen it. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** The gate configuration this suite polices, typed so a missing key is an error. */
export interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly engines: { readonly node: string }
}
export interface OxfmtConfig {
  readonly ignorePatterns?: readonly string[]
  readonly overrides?: readonly Json[]
}
export interface StrykerConfig {
  readonly mutate: readonly string[]
  readonly thresholds: Readonly<Record<string, number>>
}
export interface StrykerRunner {
  readonly testRunner: string
  readonly vitest: { readonly configFile: string }
}
export interface OxlintConfig {
  readonly categories: Readonly<Record<string, string>>
  readonly plugins: readonly string[]
  readonly rules?: Readonly<Record<string, Json>>
  readonly ignorePatterns?: readonly string[]
}
export interface TsConfigBase {
  readonly compilerOptions: Readonly<Record<string, string | boolean | undefined>>
}
export interface TsConfig {
  readonly include: readonly string[]
}
export interface KnipWorkspace {
  readonly project?: readonly string[]
  readonly entry?: readonly string[]
  readonly ignore?: readonly string[]
  readonly ignoreDependencies?: readonly string[]
}
export interface KnipConfig {
  readonly workspaces: Readonly<Record<string, KnipWorkspace>>
}

export const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))
/**
 * Every file under a tests directory, not only `*.test.ts`.
 *
 * A helper is exactly where an evasion would hide: a shared harness or an axe
 * helper with a rule-disabling default is invisible to a scan that only looks
 * at files whose name ends in `.test.ts`.
 */
export const tests = code.filter((file) => /(^|\/)tests\//.test(file))
export const sources = code.filter((file) => /^packages\/[^/]+\/src\//.test(file))
/**
 * Every TypeScript module in the tree, not only those under `src` and `tests`.
 *
 * The gate configuration is itself TypeScript — four vitest configs, three
 * tsdown configs and the two mutation-guard scripts — so a scan that stops at
 * the package directories cannot see the files that decide what the other
 * gates do. One escaped exactly there: a superseded doc block sat in
 * `vitest.a11y.config.ts` while this suite reported the tree clean.
 */
export const modules = code.filter((file) => /\.tsx?$/.test(file))
/**
 * Every Markdown page git tracks or would track: a page added but not yet
 * staged is part of the tree CI will see, so it is part of the tree the
 * diagram gates see. Ignored files stay out.
 */
export const markdown = tracked.filter((file) => file.endsWith('.md'))

/** Files containing a needle, so a failure names them. */
export const containing = (files: readonly string[], needle: string): string[] =>
  files.filter((file) => read(file).includes(needle))

/**
 * Files matching a pattern, for a shape a substring cannot express.
 *
 * The pattern is assembled from fragments for the same reason the needles are:
 * these files are themselves under `tests/`, so a literal would make a gate
 * find its own definition.
 */
export const matching = (files: readonly string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file)))

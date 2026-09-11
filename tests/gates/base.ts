/**
 * What every repository gate reads: the tracked file list, the readers, and
 * the shapes of the configurations those gates police.
 *
 * One module so a list or a type cannot drift apart between gates: a scan that
 * starts somewhere else is a scan this module cannot see.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

/**
 * Every file git tracks or would track: a new file that is not yet added is
 * part of the tree CI will see, so it is part of the tree these gates see.
 * Ignored files stay out, so build output cannot fail a gate.
 */
export const tracked = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root('..'), encoding: 'utf8' },
)
  .split('\n')
  .filter((line) => line !== '')

export const read = (file: string): string => readFileSync(root(`../${file}`), 'utf8')
export const json = <T>(file: string): T => JSON.parse(read(file)) as T

/** Values a JSON configuration file may hold. */
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | readonly ConfigValue[]
  | { readonly [key: string]: ConfigValue }

export interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly engines: { readonly node: string }
}
export interface OxfmtConfig {
  readonly ignorePatterns?: readonly string[]
  readonly overrides?: ConfigValue
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
  readonly rules?: Readonly<Record<string, ConfigValue>>
  readonly ignorePatterns?: readonly string[]
}
export interface TsConfigBase {
  readonly compilerOptions: Readonly<Record<string, ConfigValue>>
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

/** Code files: every tracked file a scanner could mean. */
export const code = tracked.filter((file) => /\.(ts|tsx|mjs|cjs|js|json|ya?ml)$/.test(file))

/**
 * Every file under a tests directory, not only `*.test.ts`.
 *
 * A helper is exactly where an evasion would hide: a shared harness or an axe
 * module with a rule-disabling default is invisible to a scan that only looks
 * at files whose name ends in `.test.ts`.
 */
export const testFiles = code.filter((file) => /(^|\/)tests\//.test(file))

/** Every published source module of the packages. */
export const sources = code.filter((file) => /^packages\/[^/]+\/src\//.test(file))

/** Every published Markdown page, which the diagram and commitment gates scan. */
export const markdown = tracked.filter((file) => file.endsWith('.md'))

/**
 * Every TypeScript module in the tree, not only those under `src` and `tests`.
 *
 * The gate configuration is itself TypeScript — four vitest configs, three
 * tsdown configs and the two mutation-guard scripts — so a scan that stops at
 * the package directories cannot see the files that decide what the other
 * gates do. One escaped exactly there: a superseded doc block sat in
 * `vitest.a11y.config.ts` while a suite reported the tree clean.
 */
export const modules = code.filter((file) => /\.tsx?$/.test(file))

/** Files containing a needle, so a failure names them. */
export const containing = (files: readonly string[], needle: string): string[] =>
  files.filter((file) => read(file).includes(needle))

/**
 * Files matching a pattern, for a shape a substring cannot express.
 *
 * Callers assemble patterns from fragments for the same reason the needles
 * are assembled: a gate file is itself under `tests/`, so a literal would make
 * the gate find its own definition.
 */
export const matching = (files: readonly string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file)))

/**
 * The repository's own configuration files, and the shapes they parse to.
 *
 * These contracts used to be declared twice — once beside the readers in
 * `base.ts` and once beside the tree lists in `support.ts` — under two names
 * for the same JSON value (`ConfigValue` and `Json`) and with a diverging
 * `OxfmtConfig.overrides`. A gate reading the weaker declaration passed against
 * a config the other declaration rejects. One declaration each.
 */

/** The JSON a configuration file parses to, typed so a scan cannot widen it. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** An exact package version, the only spelling a pin can take. */
export const EXACT_VERSION = /^\d+\.\d+\.\d+$/

/** The root manifest, typed so a missing key is an error rather than `undefined`. */
export interface PackageJson {
  readonly scripts: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly engines: { readonly node: string }
}
export interface OxfmtConfig {
  readonly ignorePatterns?: readonly string[]
  readonly overrides?: readonly Json[]
}
export interface OxlintConfig {
  readonly categories: Readonly<Record<string, string>>
  readonly plugins: readonly string[]
  readonly rules?: Readonly<Record<string, Json>>
  readonly ignorePatterns?: readonly string[]
}
export interface StrykerConfig {
  readonly mutate: readonly string[]
  readonly thresholds: Readonly<Record<string, number>>
}
export interface StrykerRunner {
  readonly testRunner: string
  readonly vitest: { readonly configFile: string }
}
export interface TsConfigBase {
  readonly compilerOptions: Readonly<Record<string, string | boolean | undefined>>
}
export interface TsConfig {
  readonly include: readonly string[]
}
interface KnipWorkspace {
  readonly project?: readonly string[]
  readonly entry?: readonly string[]
  readonly ignore?: readonly string[]
  readonly ignoreDependencies?: readonly string[]
}
export interface KnipConfig {
  readonly workspaces: Readonly<Record<string, KnipWorkspace>>
}

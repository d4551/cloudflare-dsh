/**
 * Reading the repository: the root anchor, the tracked file list, and the
 * readers and text searches every gate in this suite starts from.
 *
 * `base.ts` and `support.ts` used to hold a copy of this each — two `root`
 * functions, two `git ls-files` walks, two `read`s, two `containing`s — so a
 * gate that imported one could not see what the other described, and the same
 * reader had two spellings. One module owns reading; the tree lists derived
 * from it live in `support.ts`, the configuration contracts in `repo.ts`.
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

/** Files containing a needle, so a failure names them. */
export const containing = (files: readonly string[], needle: string): string[] =>
  files.filter((file) => read(file).includes(needle))

/**
 * Files matching a pattern, for a shape a substring cannot express.
 *
 * Callers assemble patterns from fragments for the same reason the needles
 * are: these files are themselves under `tests/`, so a literal would make the
 * gate find its own definition.
 */
export const matching = (files: readonly string[], pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(read(file)))

/**
 * Running a scanner over a tree.
 *
 * A source-scanning gate is one line — read every file in a list, run one
 * scanner over each, report what it found — and that line was written out in
 * each gate that needed it. `scanTree` is that line, once, so a gate states
 * which tree and which scanner rather than restating how to walk one.
 *
 * The scanners themselves live in `scanners.ts`; the parser they read through
 * lives in `../parse.ts`, which is the only module that calls `parseSync`.
 */
import { read } from './base.ts'

/** One scanner's finding for one module: `path:line message`, assembled by the scanner. */
export type Finding = string

/**
 * Every finding one scanner makes across a tree.
 *
 * The list is walked in order and each scanner is handed the file's text, so a
 * gate that names its tree and its scanner gets the whole result. A scanner
 * that throws on a module the parser rejects fails the gate rather than
 * silently skipping that module.
 */
export function scanTree(
  files: readonly string[],
  scanner: (name: string, text: string) => readonly Finding[],
): Finding[] {
  return files.flatMap((file) => scanner(file, read(file)))
}

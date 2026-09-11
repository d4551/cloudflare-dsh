/**
 * Parsing and positioning for the gates that read a syntax tree.
 *
 * The gates read the tree rather than the text, so a gate cannot be fooled by
 * a comment or a string that quotes the pattern it forbids. Parsing comes from
 * oxc-parser, the native parser the repository's linter and formatter run on.
 */
import { parseSync, type Comment, type Program } from 'oxc-parser'

/** One parsed module, with the text positions resolve against. */
export interface Source {
  readonly name: string
  readonly text: string
  readonly program: Program
  readonly comments: readonly Comment[]
}

/**
 * Parse one module. A module that does not parse is a defect in the tree, not
 * a pass for the gate, so the first parse error fails the scan out loud.
 */
export function parseSource(name: string, text: string): Source {
  const parsed = parseSync(name, text)
  const failure = parsed.errors[0]
  if (failure !== undefined) throw new Error(`${name}: ${failure.message}`)
  return { name, text, program: parsed.program, comments: parsed.comments }
}

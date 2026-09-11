/**
 * The syntax-tree layer every source-scanning gate reads through.
 *
 * TypeScript 7 is a native compiler with no JavaScript API, so the gates parse
 * with oxc — the same parser oxlint runs — and this module is the only place
 * that knows its shape: the language comes from the file extension, the walk
 * tracks parents and can prune a subtree, and offsets resolve to 1-based line
 * numbers counted the way JavaScript strings are indexed.
 */
import { parseSync, visitorKeys } from 'oxc-parser'
import type { Comment, Node, Program } from 'oxc-parser'

/** A parsed module, with its text so spans resolve to lines. */
export interface ParsedModule {
  readonly name: string
  readonly text: string
  readonly program: Program
  readonly comments: readonly Comment[]
  /** The 1-based line an offset sits on. */
  readonly lineAt: (offset: number) => number
}

/** Parse one TypeScript module; the extension decides `ts` against `tsx`. */
export function parseModule(name: string, text: string): ParsedModule {
  const parsed = parseSync(name, text, { lang: name.endsWith('.tsx') ? 'tsx' : 'ts' })
  const problem = parsed.errors[0]
  if (problem !== undefined) throw new Error(`${name}: ${problem.message}`)
  const lineStarts: number[] = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text.charAt(index) === '\n') lineStarts.push(index + 1)
  }
  return {
    name,
    text,
    program: parsed.program,
    comments: parsed.comments,
    lineAt(offset: number): number {
      let line = 1
      for (const start of lineStarts) {
        if (start <= offset) line += 1
      }
      return line - 1
    },
  }
}

/**
 * Whether a walked value is an AST node.
 *
 * The predicate is the boundary between the parser's plain objects and the
 * declared tree: a member of the walk is anything shaped like a node whose
 * type the parser's own visitor keys know how to descend into.
 */
function isAstNode(value: object | null | undefined): value is Node {
  if (value === null || value === undefined || Array.isArray(value) || !('type' in value)) return false
  return typeof value.type === 'string' && visitorKeys[value.type] !== undefined
}

/**
 * Depth-first walk of one node's subtree.
 *
 * The visitor receives each node with its parent (undefined at the root) and
 * returns `false` to prune: the node itself stays visited, its subtree does
 * not get walked.
 */
export function walk(
  root: Node,
  visit: (node: Node, parent: Node | undefined) => boolean | void,
): void {
  const visitNode = (node: Node, parent: Node | undefined): void => {
    if (visit(node, parent) === false) return
    for (const [key, value] of Object.entries(node)) {
      if (key === 'parent') continue
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isAstNode(child)) visitNode(child, node)
        }
      } else if (isAstNode(value)) {
        visitNode(value, node)
      }
    }
  }
  visitNode(root, undefined)
}

/** The first node in the tree whose start sits at or after one offset. */
export function firstNodeFrom(program: Program, offset: number): Node | undefined {
  let best: Node | undefined
  let bestStart = Number.POSITIVE_INFINITY
  walk(program, (node) => {
    if (node.start >= offset && node.start < bestStart) {
      best = node
      bestStart = node.start
    }
  })
  return best
}

/**
 * The syntax-tree scanners every source-scanning gate reads through.
 *
 * Each scanner reads the tree rather than the text, because a text search
 * misses the shape — it flags the word "any" in a comment, or walks past the
 * conditional inside an expression container. One implementation lives here;
 * the gate modules assert it on snippets and on the tree.
 */
import type { Node } from 'oxc-parser'
import { parseModule, walk, type ParsedModule } from '../parse.ts'

/**
 * Attributes whose value a user reads or hears.
 *
 * Everything else a component sets — `className`, `id`, `role`, `type`,
 * `scope`, `autoComplete`, every `aria-*` that names an id — is addressed to
 * the machine, so a literal there is not copy and its subtree is skipped.
 */
const USER_VISIBLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
])

/**
 * Whether a literal addresses the machine rather than the reader.
 *
 * Three shapes, all of them names rather than words: a literal type, which is
 * not a value at all; the index of a computed member access, since
 * `block['kind']` is a property name; and a literal compared against a
 * property read or a `typeof`, which is a shape being discriminated. All sit
 * in the same category as `className` and `role`, which are skipped by
 * attribute.
 */
const isMachineFacing = (node: Node, parent: Node | undefined): boolean => {
  if (parent === undefined) return false
  if (parent.type === 'TSLiteralType') return true
  if (parent.type === 'MemberExpression') return parent.computed && parent.property === node
  if (parent.type !== 'BinaryExpression') return false
  const other = parent.left === node ? parent.right : parent.left
  return (
    (other.type === 'UnaryExpression' && other.operator === 'typeof') || other.type === 'MemberExpression'
  )
}

/**
 * User-visible copy written inline in a component instead of routed through
 * the locale dictionary.
 *
 * The page states that all copy the client renders — "including accessible
 * names" — lives in the client's locale module. This scanner holds that
 * sentence: every literal in the module counts, not only the ones directly
 * between tags, so a conditional inside an expression container is found the
 * same as a text node. Machine-facing attribute values are skipped by subtree,
 * and an empty string or pure whitespace is never copy.
 */
export function inlineCopy(name: string, text: string): string[] {
  const module = parseModule(name, text)
  const found: string[] = []
  const report = (node: Node, value: string): void => {
    if (value.trim() !== '') found.push(`${name}:${module.lineAt(node.start)} ${value.trim()}`)
  }
  walk(module.program, (node, parent) => {
    if (node.type === 'JSXAttribute') {
      const named = node.name
      const attributeName =
        named.type === 'JSXIdentifier' ? named.name : `${named.namespace.name}:${named.name}`
      if (!USER_VISIBLE_ATTRIBUTES.has(attributeName)) return false
    }
    // A module specifier is a path, not something anyone reads.
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    ) {
      return false
    }
    if (node.type === 'JSXText') report(node, node.value)
    if (node.type === 'Literal' && typeof node.value === 'string' && !isMachineFacing(node, parent)) {
      report(node, node.value)
    }
    if (node.type === 'TemplateLiteral' && node.quasis.length > 1) {
      for (const quasi of node.quasis) report(node, quasi.value.cooked ?? quasi.value.raw)
    }
    return undefined
  })
  return found
}

/**
 * `any` in any type position — an annotation, a type argument, an assertion —
 * and the cast pair `x as unknown as T`, which asserts a type the compiler
 * could not derive. Both are banned by the tree scan: the words "any" or
 * "as unknown as" in a comment or a string do not match a node.
 */
export function looseTypes(name: string, text: string): string[] {
  const module = parseModule(name, text)
  const found: string[] = []
  walk(module.program, (node) => {
    if (node.type === 'TSAnyKeyword') found.push(`${name}:${module.lineAt(node.start)} any`)
    if (
      node.type === 'TSAsExpression' &&
      node.expression.type === 'TSAsExpression' &&
      node.expression.typeAnnotation.type === 'TSUnknownKeyword'
    ) {
      found.push(`${name}:${module.lineAt(node.start)} as unknown as`)
    }
    return undefined
  })
  return found
}

/**
 * Declarations with a superseded doc block above their current one.
 *
 * A rewrite that leaves the old block in place stacks two, and TypeScript
 * treats only the last as the declaration's documentation — so the superseded
 * one keeps sitting there describing what the code used to do, and a reader
 * meets it first. The comment ranges come from the parser, which attaches none
 * of its comments to the tree, so its list is the ranges the tree itself
 * cannot be asked for.
 *
 * Two blocks are stacked when nothing but one line break separates them. A
 * module's own doc block sits above the first declaration's with a blank line
 * between, which is what tells the two apart.
 */
export function stackedDocs(name: string, text: string): string[] {
  const module = parseModule(name, text)
  const found = new Set<string>()
  const docBlocks = module.comments.filter(
    (comment) => comment.type === 'Block' && text.slice(comment.start, comment.start + 3) === '/**',
  )
  for (const [index, block] of docBlocks.entries()) {
    const next = docBlocks[index + 1]
    if (next === undefined) continue
    const between = text.slice(block.end, next.start)
    if (between.split('\n').length === 2) {
      const after = text.slice(next.end)
      const following = after.slice(after.search(/\S/))
      const line = module.lineAt(next.end + (after.length - following.length))
      found.add(`${name}:${line} ${following.split('\n')[0]?.trim() ?? ''}`)
    }
  }
  return [...found]
}

/**
 * A module's text with everything that is not code blanked out.
 *
 * A capability is a fact about code, not about the characters a file happens to
 * carry: a doc line reading "never call `new Date`" names no clock, a
 * resource-type string `'fetch'` reaches no network, and the words between two
 * tags are copy rather than an expression. Comments, the contents of string,
 * template and regular-expression literals, and JSX text are replaced by
 * spaces — one space per character, so every offset still resolves to the line
 * it did — and a pattern is then matched against what is left.
 */
function codeOnly(module: ParsedModule): string {
  const blanked: { readonly start: number; readonly end: number }[] = [...module.comments]
  walk(module.program, (node) => {
    if (node.type === 'Literal' || node.type === 'JSXText') blanked.push(node)
    // The quasis are read from their parent rather than walked to, so the
    // blanking does not depend on the parser offering them as nodes.
    if (node.type === 'TemplateLiteral') {
      for (const quasi of node.quasis) blanked.push(quasi)
    }
    return undefined
  })
  const parts: string[] = []
  let at = 0
  for (const range of blanked.toSorted((left, right) => left.start - right.start)) {
    if (range.start < at) continue
    parts.push(module.text.slice(at, range.start), ' '.repeat(range.end - range.start))
    at = range.end
  }
  parts.push(module.text.slice(at))
  return parts.join('')
}

/**
 * The code in a module that names a capability, as `path:line match`.
 *
 * Every scanner here reads the tree because a text search cannot tell code from
 * prose. This one needs that distinction for a capability spelled in ordinary
 * words — `fetch`, `new Date`, `Math.random` — where a text search reads the
 * word in a comment, or inside a string enumerating a browser's resource
 * types, as a use. The pattern is matched against the module's code with the
 * prose blanked out, so a module is named for what it does rather than for
 * what its comments, its strings or its copy happen to say.
 */
export function codeUses(name: string, text: string, pattern: RegExp): string[] {
  const module = parseModule(name, text)
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const found: string[] = []
  for (const match of codeOnly(module).matchAll(new RegExp(pattern.source, flags))) {
    if (match.index === undefined) continue
    found.push(`${name}:${module.lineAt(match.index)} ${match[0]}`)
  }
  return found
}

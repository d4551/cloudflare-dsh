/**
 * The syntax-tree gates: inline copy, type holes, superseded docs.
 *
 * Each scanner reads the tree rather than the text, because a text search
 * misses the shape — it flags the word "any" in a comment, or walks past the
 * conditional inside an expression container. Every scanner is proven on
 * snippets before it is trusted on the tree.
 */
import { type Node } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { parseModule, walk } from '../parse.ts'
import { containing, modules, read, sources, testFiles } from './base.ts'

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
    (other.type === 'UnaryExpression' && other.operator === 'typeof') ||
    other.type === 'MemberExpression'
  )
}

/**
 * User-visible copy written inline in a component instead of routed through
 * the locale dictionary.
 *
 * The page states that all copy the client renders — "including accessible
 * names" — lives in the client's locale module. This gate holds that sentence:
 * every literal in the module counts, not only the ones directly between tags,
 * so a conditional inside an expression container is found the same as a text
 * node. Machine-facing attribute values are skipped by subtree, and an empty
 * string or pure whitespace is never copy.
 */
function inlineCopy(name: string, text: string): string[] {
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

describe('user-facing copy lives in the dictionary', () => {
  it.each([
    ['text between tags', 'const A = () => <b>Hide detail</b>', ['probe.tsx:1 Hide detail']],
    ['a term in a list', 'const A = () => <dl><dt>Cached</dt></dl>', ['probe.tsx:1 Cached']],
    [
      'a literal inside a conditional expression',
      "const A = (p: { x: boolean }) => <b>{p.x ? 'Hide detail' : 'Show detail'}</b>",
      ['probe.tsx:1 Hide detail', 'probe.tsx:1 Show detail'],
    ],
    ['a quoted accessible name', 'const A = () => <b aria-label="Usage" />', ['probe.tsx:1 Usage']],
    ['alternative text', 'const A = () => <img alt="A chart" src="s" />', ['probe.tsx:1 A chart']],
    [
      'a literal returned by a helper the component renders',
      "function d(): string {\n  return 'unknown'\n}",
      ['probe.tsx:2 unknown'],
    ],
    [
      'a separator interpolated into displayed text',
      'const d = (a: string, b: string) => `${a}: ${b}`',
      ['probe.tsx:1 :'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(inlineCopy('probe.tsx', snippet)).toEqual(expected)
  })

  it.each([
    ['copy read from the dictionary', 'const A = () => <b>{en.cost.label}</b>'],
    ['a name read from the dictionary', 'const A = () => <b aria-label={en.cost.label} />'],
    ['a machine-facing attribute', 'const A = () => <b className="cf-chip" id="x" role="status" />'],
    ['an interpolated value', 'const A = (p: { n: number }) => <b>{p.n}</b>'],
    ['whitespace between elements', 'const A = () => (\n  <b>\n    <i>{en.x}</i>\n  </b>\n)'],
    ['an empty string', "const [v, s] = useState('')"],
    ['a whitespace-only join', 'const ids = (a: string, b: string) => `${a} ${b}`'],
    // Assembled, because the needle above forbids this file naming that path.
    ['an import specifier', `import { en } from './locales/${'en'}.ts'`],
    ['a typeof comparison', "const f = (v: unknown) => typeof v === 'string'"],
    ['a typeof comparison written the other way round', "const f = (v: unknown) => 'string' === typeof v"],
    ['a property name', "const f = (v: Record<string, unknown>) => v['sql']"],
    [
      'a shape being discriminated by index',
      "const f = (v: Record<string, unknown>) => v['kind'] === 'tool-result'",
    ],
    ['a shape being discriminated by property', "const f = (v: { type: string }) => v.type === 'text'"],
    ['a literal type', "interface B {\n  kind: 'tool-result'\n}"],
  ])('passes %s', (_label, snippet) => {
    expect(inlineCopy('probe.tsx', snippet)).toEqual([])
  })

  it('finds no inline copy in any client component', () => {
    const components = sources.filter(
      (file) => file.startsWith('packages/client/src/') && file.endsWith('.tsx'),
    )
    expect(components.length).toBeGreaterThan(0)
    expect(components.flatMap((file) => inlineCopy(file, read(file)))).toEqual([])
  })

  it('never lets a test import the locale, so an assertion cannot compare a string with itself', () => {
    // A test that reads `en.cost.empty` and looks for `en.cost.empty` passes
    // whatever the copy says. Pinning the literal is what makes copy a contract.
    expect(containing(testFiles, `locales/${'en'}`)).toEqual([])
  })
})

/**
 * `any` in any type position — an annotation, a type argument, an assertion —
 * and the cast pair `x as unknown as T`, which asserts a type the compiler
 * could not derive. Both are banned by the tree scan: the words "any" or
 * "as unknown as" in a comment or a string do not match a node.
 */
function looseTypes(name: string, text: string): string[] {
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

describe('no loose types in the tree', () => {
  it.each([
    ['an annotation', 'let a: any', ['probe.ts:1 any']],
    ['a type argument', 'let r: Record<string, any> = {}', ['probe.ts:1 any']],
    ['an assertion', 'const a = (1 as any).x', ['probe.ts:1 any']],
    ['a cast pair', 'const s = 1 as unknown as string', ['probe.ts:1 as unknown as']],
    [
      'a cast pair on a later line',
      'const n = 1\nconst s = n as unknown as string',
      ['probe.ts:2 as unknown as'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(looseTypes('probe.ts', snippet)).toEqual(expected)
  })

  it.each([
    ['a single widening cast', 'const u = 1 as unknown'],
    ['a value typed by inference', 'const s = String(1)'],
    ['the word in a comment', '// no other node kind has any'],
    ['the words in a string', "const s = 'as unknown as'"],
    ['a JSX file with a typed prop', 'export const A = (p: { n: number }) => <b>{p.n}</b>'],
  ])('passes %s', (_label, snippet) => {
    expect(looseTypes(_label.startsWith('a JSX') ? 'probe.tsx' : 'probe.ts', snippet)).toEqual([])
  })

  it('finds none in any TypeScript module the tree carries', () => {
    expect(modules.flatMap((file) => looseTypes(file, read(file)))).toEqual([])
  })
})

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
function stackedDocs(name: string, text: string): string[] {
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

describe('no superseded doc blocks', () => {
  it.each([
    [
      'two blocks stacked on one declaration',
      '/** the old shape */\n/** the current shape */\nexport const a = 1',
      ['probe.ts:3 export const a = 1'],
    ],
    [
      'a block stacked above a function',
      '/** old */\n/** current */\nfunction f(): number {\n  return 1\n}',
      ['probe.ts:3 function f(): number {'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(stackedDocs('probe.ts', snippet)).toEqual(expected)
  })

  it.each([
    ['one block', '/** only */\nexport const a = 1'],
    ['no block', 'export const a = 1'],
    ['a block each on two declarations', '/** a */\nexport const a = 1\n/** b */\nexport const b = 2'],
    ['a line comment above a block', '// note\n/** doc */\nexport const a = 1'],
    ['a plain block above a doc block', '/* note */\n/** doc */\nexport const a = 1'],
    ['a module doc a blank line above the first', '/** module */\n\n/** doc */\nexport const a = 1'],
  ])('passes %s', (_label, snippet) => {
    expect(stackedDocs('probe.ts', snippet)).toEqual([])
  })

  it('finds none in any TypeScript module the tree carries', () => {
    expect(modules.flatMap((file) => stackedDocs(file, read(file)))).toEqual([])
  })
})

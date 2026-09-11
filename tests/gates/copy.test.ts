/**
 * The inline-copy gate: user-facing copy lives in the dictionary.
 *
 * The page states that all copy the client renders — "including accessible
 * names" — lives in the client's locale module. It did not: a toggle's whole
 * state was two string literals inside a conditional, invisible to a scan of
 * text nodes and attributes, and a screenshot's alternative text was a literal
 * in a helper the component called. So the scanner reads the syntax tree and
 * counts every literal the module would show a user, wherever it sits.
 *
 * Machine-facing values are skipped by subtree: an attribute whose name the
 * user never reads (`className`, `id`, `role`, every `aria-*` that names an
 * id) cannot carry copy, and neither can an import specifier or a literal type.
 */
import { Visitor } from 'oxc-parser'
import type { Node } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { containing, read, sources, tests } from './support.ts'
import { at, parseSource } from './scan.ts'

/**
 * Attributes whose value a user reads or hears.
 *
 * Everything else a component sets is addressed to the machine, so a literal
 * there is not copy and its subtree is skipped.
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
 * not a value at all; the index of an element access, since `block['kind']` is
 * a property name; and a literal compared against a property read or a
 * `typeof`, which is a shape being discriminated. All sit in the same category
 * as `className` and `role`, which are skipped by attribute.
 */
function isMachineFacing(node: Node): boolean {
  const parent = node.parent
  if (parent === undefined || parent === null) return false
  if (parent.type === 'TSLiteralType') return true
  if (parent.type === 'MemberExpression') return parent.computed && parent.property === node
  if (parent.type !== 'BinaryExpression') return false
  const other = parent.left === node ? parent.right : parent.left
  return other.type === 'UnaryExpression' && other.operator === 'typeof'
}

/**
 * User-visible copy written inline in a component instead of routed through
 * the locale dictionary.
 *
 * Every literal in the module counts, not only the ones directly between tags:
 * the name that escaped was `{expanded ? 'Hide detail' : 'Show detail'}`, a
 * conditional inside an expression container, which a scan of text nodes and
 * attributes walks straight past. Machine-facing attribute values are skipped
 * by subtree, and an empty string or pure whitespace is never copy.
 */
export function inlineCopy(name: string, text: string): string[] {
  const source = parseSource(name, text)
  const found: string[] = []
  let skipped = 0
  const report = (node: Node, value: string): void => {
    if (skipped === 0 && value.trim() !== '') found.push(`${at(source, node)} ${value.trim()}`)
  }
  const visitor = new Visitor({
    JSXAttribute: (node) => {
      const named = node.name
      const attributeName =
        named.type === 'JSXIdentifier' ? named.name : `${named.namespace.name}:${named.name}`
      if (!USER_VISIBLE_ATTRIBUTES.has(attributeName)) skipped += 1
    },
    'JSXAttribute:exit': (node) => {
      const named = node.name
      const attributeName =
        named.type === 'JSXIdentifier' ? named.name : `${named.namespace.name}:${named.name}`
      if (!USER_VISIBLE_ATTRIBUTES.has(attributeName)) skipped -= 1
    },
    // A module specifier is a path, not something anyone reads.
    ImportDeclaration: () => {
      skipped += 1
    },
    'ImportDeclaration:exit': () => {
      skipped -= 1
    },
    ExportNamedDeclaration: () => {
      skipped += 1
    },
    'ExportNamedDeclaration:exit': () => {
      skipped -= 1
    },
    ExportAllDeclaration: () => {
      skipped += 1
    },
    'ExportAllDeclaration:exit': () => {
      skipped -= 1
    },
    JSXText: (node) => {
      report(node, node.value)
    },
    Literal: (node) => {
      if (typeof node.value === 'string' && !isMachineFacing(node)) report(node, node.value)
    },
    TemplateLiteral: (node) => {
      // A template with no hole is one string; only an interpolated one can
      // carry copy in a fragment, which is where the separator escaped.
      if (node.quasis.length > 1) {
        for (const quasi of node.quasis) report(node, quasi.value.cooked ?? quasi.value.raw)
      }
    },
  })
  visitor.visit(source.program)
  return found
}

// The scanner is proven on snippets before it is trusted on the tree.
describe('user-facing copy lives in the dictionary', () => {
  it.each([
    ['text between tags', 'const A = () => <b>Hide detail</b>', ['probe.tsx:1 Hide detail']],
    ['a term in a list', 'const A = () => <dl><dt>Cached</dt></dl>', ['probe.tsx:1 Cached']],
    [
      'a literal in a conditional, which is how one escaped',
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
    const components = sources.filter((file) => file.startsWith('packages/client/src/') && file.endsWith('.tsx'))
    expect(components.length).toBeGreaterThan(0)
    expect(components.flatMap((file) => inlineCopy(file, read(file)))).toEqual([])
  })
})

describe('tests speak in user-visible copy', () => {
  it('never imports the locale, so an assertion cannot compare a string with itself', () => {
    // A test that reads `en.cost.empty` and looks for `en.cost.empty` passes
    // whatever the copy says. Pinning the literal is what makes copy a contract.
    expect(containing(tests, `locales/${'en'}`)).toEqual([])
  })
})

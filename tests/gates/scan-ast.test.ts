/**
 * The syntax-tree gates: snippet proofs for the shared scanners.
 *
 * Each scanner in `scanners.ts` reads the tree rather than the text, because a
 * text search misses the shape — it flags the word "any" in a comment, or
 * walks past the conditional inside an expression container. This module
 * proves each scanner on snippets before the gate modules trust it on the
 * tree; the tree-wide scans live beside this one in `tests/gates/`.
 */
import { describe, expect, it } from 'vitest'
import { inlineCopy, looseTypes, stackedDocs } from './scanners.ts'

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
})

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
})

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
})

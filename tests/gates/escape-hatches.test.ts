/**
 * The escape-hatch gate.
 *
 * Type escape hatches are read from a module's syntax tree rather than its
 * text: `any` in any type position — an annotation, a type argument, an
 * assertion — and the double cast `x as unknown as T`, which asserts a type
 * the compiler could not derive. A text search misses `Record<string, any>`
 * and flags the word "any" in a comment; the tree does neither.
 */
import { Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { modules, read } from './support.ts'
import { at, parseSource } from './scan.ts'

export function escapeHatches(name: string, text: string): string[] {
  const source = parseSource(name, text)
  const found: string[] = []
  const visitor = new Visitor({
    TSAnyKeyword: (node) => {
      found.push(`${at(source, node)} any`)
    },
    TSAsExpression: (node) => {
      const inner = node.expression
      if (inner.type === 'TSAsExpression' && inner.typeAnnotation.type === 'TSUnknownKeyword') {
        found.push(`${at(source, node)} as unknown as`)
      }
    },
  })
  visitor.visit(source.program)
  return found
}

// The scanner is proven on snippets before it is trusted on the tree.
describe('no type escape hatch', () => {
  it.each([
    ['an annotation', 'let a: any', ['probe.ts:1 any']],
    ['a type argument', 'let r: Record<string, any> = {}', ['probe.ts:1 any']],
    ['an assertion', 'const a = (1 as any).x', ['probe.ts:1 any']],
    ['a double cast', 'const s = 1 as unknown as string', ['probe.ts:1 as unknown as']],
    [
      'a double cast on a later line',
      'const n = 1\nconst s = n as unknown as string',
      ['probe.ts:2 as unknown as'],
    ],
  ])('finds %s', (_label, snippet, expected) => {
    expect(escapeHatches('probe.ts', snippet)).toEqual(expected)
  })

  it.each([
    ['a single widening cast', 'const u = 1 as unknown'],
    ['a value typed by inference', 'const s = String(1)'],
    ['the word in a comment', '// no other node kind has any'],
    ['the words in a string', "const s = 'as unknown as'"],
    ['a JSX file with a typed prop', 'export const A = (p: { n: number }) => <b>{p.n}</b>'],
  ])('passes %s', (_label, snippet) => {
    expect(escapeHatches(_label.startsWith('a JSX') ? 'probe.tsx' : 'probe.ts', snippet)).toEqual([])
  })

  it('finds none in any TypeScript module the tree carries', () => {
    expect(modules.flatMap((file) => escapeHatches(file, read(file)))).toEqual([])
  })
})

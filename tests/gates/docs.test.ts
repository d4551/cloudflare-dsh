/**
 * The superseded-doc gate.
 *
 * Declarations with a superseded doc block above their current one. A rewrite
 * that leaves the old block in place stacks two, and TypeScript treats only
 * the last as the declaration's documentation — so the superseded one keeps
 * sitting there describing what the code used to do, and a reader meets it
 * first. One did: `listAll` was documented as "yielding items" long after it
 * stopped being a generator. The comment ranges are read from the parse
 * result, because the tree drops the block it does not consider current.
 *
 * Two blocks are stacked when nothing but one line break separates them. A
 * module's own doc block sits above the first declaration's with a blank line
 * between, which is what tells the two apart.
 */
import { describe, expect, it } from 'vitest'
import { modules, read } from './support.ts'
import { lineOf, parseSource } from './scan.ts'

export function stackedDocs(name: string, text: string): string[] {
  const source = parseSource(name, text)
  const found = new Set<string>()
  // The doc blocks, in source order; only `/**` counts, since a plain block or
  // a line comment is a note rather than documentation.
  const docs = source.comments.filter((comment) => comment.type === 'Block' && comment.value.startsWith('*'))
  for (const [index, block] of docs.entries()) {
    const next = docs[index + 1]
    if (next === undefined) continue
    // Nothing but one line break between the two blocks.
    if (source.text.slice(block.end, next.start).split('\n').length !== 2) continue
    // The second block must lead a declaration: the next token after it, with
    // only whitespace between, is that declaration's first token, and the
    // finding names the line that declaration starts on.
    const after = source.text.slice(next.end)
    const lead = after.length - after.trimStart().length
    if (lead < after.length) found.add(`${name}:${lineOf(source.text, next.end + lead)}`)
  }
  return [...found]
}

// The scanner is proven on snippets before it is trusted on the tree.
describe('no superseded doc block', () => {
  it.each([
    ['two blocks above one declaration', '/** old */\n/** new */\nexport const a = 1', ['probe.ts:3']],
    ['two blocks above a method', 'class C {\n  /** old */\n  /** new */\n  m(): void {}\n}', ['probe.ts:4']],
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

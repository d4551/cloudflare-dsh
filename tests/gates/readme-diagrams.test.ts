/**
 * The diagram and commitment gates for the published pages.
 *
 * One diagram stopped rendering: Mermaid reads a semicolon as a statement
 * separator wherever one appears — inside the text of a `Note over` exactly as
 * much as between two statements — so a sentence written with one ended the
 * note early, the clause after it was read as an actor, and "How a model call
 * flows" became a parse error on the project page. Mermaid documents a numeric
 * character entity as the way to write one that survives its lexer, and this
 * suite refuses that too: a reader of the source meets the escape rather than
 * the punctuation, and a diagram label that needs one is a sentence to rewrite.
 * So the rule is that no diagram carries a semicolon in any form.
 *
 * What this suite does not do is parse the diagrams. Parsing would mean the
 * `mermaid` package, whose published declarations import `type-fest` without
 * depending on it (mermaid-js issue 6629): with `skipLibCheck` off the
 * compiler stops, and adding `type-fest` to satisfy it leaves knip reporting a
 * dependency no source file imports — whose only documented remedy is the
 * `ignoreDependencies` list the invariants forbid. Rather than soften one gate
 * to install another, this asserts the rule that actually failed and states
 * what it leaves unchecked: a malformed arrow or an unknown diagram keyword is
 * not caught here.
 */
import { describe, expect, it } from 'vitest'
import { markdown, read } from './support.ts'

/** One fenced Mermaid block. */
interface Diagram {
  readonly file: string
  /** 1-based line of the block's first line, so a finding names it. */
  readonly line: number
  readonly body: readonly string[]
}

/** Assembled rather than written, so this file is not itself one long fence. */
const FENCE = '`'.repeat(3)

/**
 * The entity form of the separator, assembled so this file carries neither
 * form of what it forbids.
 */
const ENTITY = `${'#'}59;`

/** Join lines into a page, the way a writer would. */
const page = (...lines: readonly string[]): string => lines.join('\n')

/**
 * The Mermaid blocks in one Markdown file.
 *
 * A block whose fence was never closed still yields its content: a fence
 * someone forgot to close must not be how a diagram slips past the rules.
 */
export function diagramsIn(file: string, text: string): Diagram[] {
  const found: Diagram[] = []
  let line: number | undefined
  let body: string[] = []
  for (const [index, content] of text.split('\n').entries()) {
    if (line === undefined) {
      if (content === `${FENCE}mermaid`) {
        line = index + 2
        body = []
      }
    } else if (content === FENCE) {
      found.push({ file, line, body })
      line = undefined
    } else {
      body.push(content)
    }
  }
  if (line !== undefined) found.push({ file, line, body })
  return found
}

/** What Mermaid reads as the end of a statement, wherever it appears. */
const SEPARATOR = ';'

/** Every line of a diagram carrying a raw statement separator. */
const separators = (diagram: Diagram): string[] =>
  diagram.body.flatMap((text, index) =>
    text.includes(SEPARATOR) ? [`${diagram.file}:${diagram.line + index}: ${text.trim()}`] : [],
  )

/** A block Mermaid would be handed nothing to draw. */
const isBlank = (diagram: Diagram): boolean => diagram.body.every((line) => line.trim() === '')

describe('the diagram scanner', () => {
  it('reads a block and reports the line its first line sits on', () => {
    expect(
      diagramsIn('page.md', page('# Title', '', `${FENCE}mermaid`, 'graph LR', '  A --> B', FENCE)),
    ).toEqual([{ file: 'page.md', line: 4, body: ['graph LR', '  A --> B'] }])
  })

  it('reads every block on a page, not just the first', () => {
    expect(
      diagramsIn(
        'page.md',
        page(`${FENCE}mermaid`, 'graph LR', FENCE, '', `${FENCE}mermaid`, 'graph TD', FENCE),
      ).map((diagram) => diagram.body),
    ).toEqual([['graph LR'], ['graph TD']])
  })

  it('reads a block whose fence was never closed, so nothing escapes by omission', () => {
    expect(diagramsIn('page.md', page(`${FENCE}mermaid`, 'graph LR'))).toEqual([
      { file: 'page.md', line: 2, body: ['graph LR'] },
    ])
  })

  it('leaves a fence of another language alone', () => {
    expect(diagramsIn('page.md', page(`${FENCE}ts`, 'const a = 1', FENCE))).toEqual([])
  })
})

describe('the separator rule', () => {
  it('names the line and quotes it, so a finding is actionable', () => {
    const [diagram] = diagramsIn(
      'page.md',
      page(
        `${FENCE}mermaid`,
        'sequenceDiagram',
        '  A->>B: go',
        `  Note over A: remembered${SEPARATOR} the token never is.`,
        FENCE,
      ),
    )
    expect(diagram === undefined ? [] : separators(diagram)).toEqual([
      'page.md:4: Note over A: remembered; the token never is.',
    ])
  })

  it('passes a diagram whose prose carries no separator', () => {
    expect(separators({ file: 'page.md', line: 1, body: ['graph LR', '  A --> B'] })).toEqual([])
  })

  it('refuses the entity form too, since a reader would not know which was meant', () => {
    expect(
      separators({ file: 'page.md', line: 1, body: ['sequenceDiagram', `  A->>B: one${ENTITY} two`] }),
    ).toEqual([`page.md:2: A->>B: one${ENTITY} two`])
  })
})

describe('the blank-block rule', () => {
  it('finds a block with nothing in it to draw', () => {
    expect(isBlank({ file: 'page.md', line: 1, body: ['', '   '] })).toBe(true)
  })

  it('leaves a block with a diagram in it alone', () => {
    expect(isBlank({ file: 'page.md', line: 1, body: ['graph LR'] })).toBe(false)
  })
})

describe('the documentation', () => {
  const diagrams = markdown.flatMap((file) => diagramsIn(file, read(file)))

  it('carries diagrams for this gate to hold', () => {
    expect(diagrams.length).toBeGreaterThan(0)
  })

  it('writes no statement separator inside one', () => {
    expect(diagrams.flatMap(separators)).toEqual([])
  })

  it('leaves none of them empty', () => {
    expect(diagrams.filter(isBlank).map((diagram) => `${diagram.file}:${diagram.line}`)).toEqual([])
  })
})

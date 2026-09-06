/**
 * The README's measurable claims, and its diagrams, as a gate.
 *
 * Three kinds of rot reached the published page because nothing checked it.
 *
 * The counts drifted: the architecture diagram still said fifteen AI tools and
 * two web tools, and the "explain like I'm 5" section still said thirty-two
 * actions, while the tree had eighteen, three and thirty-six. Eleven tools were
 * named only by suffix, so those names appeared nowhere and no reader could
 * search for them.
 *
 * The configuration tables fell behind their schemas: `cloudflare-llm` had
 * grown three fields a `cordis.yml` could set and the page did not mention,
 * under a sentence promising that no tunable is hidden.
 *
 * And one diagram stopped rendering: Mermaid reads a semicolon as a statement
 * separator wherever one appears — inside the text of a `Note over` exactly as
 * much as between two statements — so a sentence written with one ended the
 * note early, the clause after it was read as an actor, and "How a model call
 * flows" became a parse error on the project page. The separator has to be
 * written as the entity `#59;` to survive.
 *
 * What this suite does not do is parse the diagrams. Parsing would mean the
 * `mermaid` package, whose published declarations import `type-fest` without
 * depending on it (mermaid-js/mermaid#6629): with `skipLibCheck` off the
 * compiler stops, and adding `type-fest` to satisfy it leaves knip reporting a
 * dependency no source file imports — whose only documented remedy is the
 * `ignoreDependencies` list the invariants forbid. Rather than soften one gate
 * to install another, this asserts the rule that actually failed and states
 * what it leaves unchecked: a malformed arrow or an unknown diagram keyword is
 * not caught here.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const read = (file: string): string => readFileSync(root(`../${file}`), 'utf8')

/**
 * Every Markdown file git tracks or would track: a page added but not yet
 * staged is part of the tree CI will see, so it is part of the tree this gate
 * sees. Ignored files stay out.
 */
const markdown = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  cwd: root('..'),
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => file.endsWith('.md'))

/** The tool modules, each a patch row of its own. */
const MODULES: readonly string[] = ['ai', 'data', 'web', 'meta']

/**
 * Every tool one module defines, read from its syntax tree rather than its
 * text: `defineTool` is what makes a tool, so a `name` in an output schema or a
 * description that quotes one cannot be counted as a registration.
 */
function toolsIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineTool'
    ) {
      const [definition] = node.arguments
      if (definition !== undefined && ts.isObjectLiteralExpression(definition)) {
        for (const property of definition.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === 'name' &&
            ts.isStringLiteral(property.initializer)
          ) {
            found.push(property.initializer.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const defined = new Map(
  MODULES.map((module) => [module, toolsIn(module, read(`packages/bundle/src/tools/${module}.ts`))]),
)
const allDefined = MODULES.flatMap((module) => defined.get(module) ?? [])

/** Every count a pattern claims, in the order the page states them. */
const claimed = (text: string, pattern: RegExp): string[][] =>
  [...text.matchAll(pattern)].map((match) => match.slice(1))

const readme = read('README.md')

/** The catalogue section alone, so a name in prose does not stand in for a table row. */
const catalogue = (): string => {
  const start = readme.indexOf('## Tool catalogue')
  return readme.slice(start, readme.indexOf('\n## ', start + 1))
}

/** Every tool name a stretch of the page mentions, once each, in name order. */
const named = (text: string): string[] => [...new Set(text.match(/cloudflare_[a-z0-9_]+/g) ?? [])].toSorted()

/** Each configured row, and the module whose schema decides what it accepts. */
const CONFIGS: readonly { readonly row: string; readonly file: string }[] = [
  { row: 'cloudflare', file: 'packages/core/src/config.ts' },
  { row: 'cloudflare-llm', file: 'packages/bundle/src/ai/index.ts' },
  { row: 'cloudflare-tools-ai', file: 'packages/bundle/src/tools/ai.ts' },
  { row: 'cloudflare-tools-data', file: 'packages/bundle/src/tools/data.ts' },
  { row: 'cloudflare-tools-web', file: 'packages/bundle/src/tools/web.ts' },
  { row: 'cloudflare-tools-meta', file: 'packages/bundle/src/tools/meta.ts' },
]

/**
 * The fields one row's configuration schema accepts, read from its syntax tree:
 * a `Schema.object` shape is what `cordis.yml` may set, so a field added there
 * and nowhere else is exactly the kind that goes undocumented.
 */
function fieldsIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Schema' &&
      node.expression.name.text === 'object'
    ) {
      const [shape] = node.arguments
      if (shape !== undefined && ts.isObjectLiteralExpression(shape)) {
        for (const property of shape.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name)) {
            found.push(property.name.text)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The stretch of the page under one row's configuration heading. */
function sectionFor(row: string): string {
  const start = readme.indexOf(`### \`${row}\``)
  const end = readme.indexOf('\n### ', start + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

/** The field each table row names in its first column. */
const fieldsDocumented = (section: string): string[] =>
  section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .flatMap((line) => {
      const [first] = line.slice(1).split('|')
      const field = /^\s*`([A-Za-z][A-Za-z0-9]*)`\s*$/.exec(first ?? '')
      return field?.[1] === undefined ? [] : [field[1]]
    })

/** Every slot the client package names, read from its `*_SLOT` constants. */
function slotsIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('_SLOT') &&
      node.initializer !== undefined &&
      ts.isStringLiteral(node.initializer)
    ) {
      found.push(node.initializer.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** The slot each row of the Web Client table names, from its second column. */
const slotsDocumented = (section: string): string[] =>
  section
    .split('\n')
    .filter((line) => line.startsWith('| '))
    .flatMap((line) => {
      const cell = line.slice(1).split('|')[1] ?? ''
      const first = /`([a-z][a-zA-Z0-9.]*)`/.exec(cell)
      return first?.[1] === undefined ? [] : [first[1]]
    })

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
 * The Mermaid blocks in one Markdown file.
 *
 * A block whose fence was never closed still yields its content: a fence
 * someone forgot to close must not be how a diagram slips past the rules.
 */
function diagramsIn(file: string, text: string): Diagram[] {
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
const isBlank = (diagram: Diagram): boolean => diagram.body.every((text) => text.trim() === '')

const page = (...lines: readonly string[]): string => lines.join('\n')

describe('the tool scanner', () => {
  // The scanner is proven on snippets before it is trusted on the tree: a gate
  // nobody has seen fail is not known to work.
  it('reads the name of a defined tool', () => {
    expect(
      toolsIn('m.ts', "ctx.tools.register(defineTool({ name: 'cloudflare_x', description: 'd' }))"),
    ).toEqual(['cloudflare_x'])
  })

  it('reads every tool in a module', () => {
    expect(
      toolsIn('m.ts', page("defineTool({ name: 'cloudflare_a' })", "defineTool({ name: 'cloudflare_b' })")),
    ).toEqual(['cloudflare_a', 'cloudflare_b'])
  })

  it('counts no name outside a tool definition', () => {
    // An output schema describes a field called `name`; a description quotes a
    // tool. Neither registers anything.
    expect(
      toolsIn(
        'm.ts',
        page("const output = { name: 'cloudflare_not_a_tool' }", "other({ name: 'cloudflare_x' })"),
      ),
    ).toEqual([])
  })

  it('counts no name that is not a literal, since nothing could verify it', () => {
    expect(toolsIn('m.ts', 'defineTool({ name: slug })')).toEqual([])
  })
})

describe('the tool catalogue', () => {
  it('finds the tools this documentation is about', () => {
    expect(allDefined.length).toBeGreaterThan(0)
  })

  it('registers each tool name exactly once across every module', () => {
    expect(allDefined.filter((tool, index) => allDefined.indexOf(tool) !== index)).toEqual([])
  })

  it('documents exactly the tools that exist, with no name left out and none invented', () => {
    expect(named(catalogue())).toEqual(allDefined.toSorted())
  })

  it('mentions no tool anywhere on the page that the bundle does not define', () => {
    expect(named(readme).filter((tool) => !allDefined.includes(tool))).toEqual([])
  })
})

describe('every stated count is the measured one', () => {
  it('heads each catalogue section with the number of tools in that module', () => {
    expect(claimed(readme, /^### .* — `cloudflare-dsh\/tools\/([a-z]+)` \((\d+)\)$/gm)).toEqual(
      MODULES.map((module) => [module, String(defined.get(module)?.length)]),
    )
  })

  it('labels each module in the architecture diagram with the same number', () => {
    expect(claimed(readme, /tools\/([a-z]+) — (\d+) tools/g)).toEqual(
      MODULES.map((module) => [module, String(defined.get(module)?.length)]),
    )
  })

  it('states the total once at the top of the page', () => {
    expect(claimed(readme, /\*\*(\d+) tools\*\*/g)).toEqual([[String(allDefined.length)]])
  })

  it('states the same total where the page explains itself simply', () => {
    expect(claimed(readme, /(\d+) specific, typed actions/g)).toEqual([[String(allDefined.length)]])
  })
})

describe('the configuration schemas', () => {
  // The scanner is proven on snippets before it is trusted on the tree.
  it('reads the fields of a schema shape', () => {
    expect(fieldsIn('c.ts', 'const C = Schema.object({ a: Schema.string(), b: Schema.number() })')).toEqual([
      'a',
      'b',
    ])
  })

  it('reads no field from another builder', () => {
    expect(fieldsIn('c.ts', 'const C = Other.object({ a: Schema.string() })')).toEqual([])
  })

  it.each(CONFIGS.map((config) => [config.row, config.file]))(
    'documents every field %s accepts, and invents none',
    (row, file) => {
      expect(fieldsDocumented(sectionFor(row)).toSorted()).toEqual(fieldsIn(file, read(file)).toSorted())
    },
  )
})

describe('the Web Client surfaces', () => {
  const CLIENT = 'packages/client/src/index.ts'

  it('reads the slots a package names', () => {
    expect(slotsIn('c.ts', "export const A_SLOT = 'one.two'\nconst other = 'three'")).toEqual(['one.two'])
  })

  it('names every slot the client contributes into, and no other', () => {
    const section = readme.slice(
      readme.indexOf('## Web Client surfaces'),
      readme.indexOf('\n## ', readme.indexOf('## Web Client surfaces') + 1),
    )
    expect([...new Set(slotsDocumented(section))].toSorted()).toEqual(
      slotsIn(CLIENT, read(CLIENT)).toSorted(),
    )
  })
})

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
      separators({ file: 'page.md', line: 1, body: ['sequenceDiagram', '  A->>B: one#59; two'] }),
    ).toEqual(['page.md:2: A->>B: one#59; two'])
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

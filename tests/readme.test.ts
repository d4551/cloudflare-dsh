/**
 * The README's measurable claims, as a gate.
 *
 * Three kinds of rot reached the published page because nothing checked it.
 *
 * The counts drifted: the architecture diagram still said fifteen AI tools and
 * two web tools, and the "explain like I'm 5" section still said thirty-two
 * actions, while the tree had eighteen, three and thirty-six. Eleven tools were
 * named only by suffix, so those names appeared nowhere and no reader could
 * search for them.
 *
 * And the configuration tables fell behind their schemas: `cloudflare-llm` had
 * grown three fields a `cordis.yml` could set and the page did not mention,
 * under a sentence promising that no tunable is hidden.
 *
 * The diagram, slot and commitment gates live beside this one in `tests/gates/`.
 * What this file holds is the tool catalogue, the counts, and the configuration
 * tables.
 */
import { readdirSync, statSync } from 'node:fs'
import { Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { parseSource } from './gates/scan.ts'
import { markdown, read, root } from './gates/support.ts'

/** Every `.ts`/`.tsx` file under one directory of the repository. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(root(dir)).flatMap((entry) => {
    const path = `${dir}/${entry}`
    if (statSync(root(path)).isDirectory()) return sourcesUnder(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

/** The directory a repository-relative path sits in. */
const directoryOf = (file: string): string => file.slice(0, file.lastIndexOf('/'))

/** Where the bundle keeps its tool modules. */
const TOOL_DIR = 'packages/bundle/src/tools'

/** Every source root a package has, found rather than listed. */
const PACKAGE_SOURCES = readdirSync(root('packages')).map((pkg) => `packages/${pkg}/src`)

/**
 * Every tool one module defines, read from its syntax tree rather than its
 * text: `defineTool` is what makes a tool, so a `name` in an output schema or a
 * description that quotes one cannot be counted as a registration.
 */
export function toolsIn(file: string, text: string): string[] {
  const source = parseSource(file, text)
  const found: string[] = []
  const visitor = new Visitor({
    CallExpression: (node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'defineTool') return
      const definition = node.arguments[0]
      if (definition === undefined || definition.type !== 'ObjectExpression') return
      for (const property of definition.properties) {
        if (
          property.type === 'Property' &&
          property.key.type === 'Identifier' &&
          property.key.name === 'name' &&
          property.value.type === 'Literal' &&
          typeof property.value.value === 'string'
        ) {
          found.push(property.value.value)
        }
      }
    },
  })
  visitor.visit(source.program)
  return found
}

/**
 * The tool modules, discovered rather than listed: every file under the tools
 * directory that defines at least one. A maintained list is checkable by
 * omission — a module nobody added to it documents itself, and the gate stays
 * green — which is the shape this repository refuses everywhere else.
 */
const defined = new Map(
  sourcesUnder(TOOL_DIR)
    .map((file) => ({
      module: file.slice(TOOL_DIR.length + 1).replace(/\.tsx?$/, ''),
      tools: toolsIn(file, read(file)),
    }))
    .filter((entry) => entry.tools.length > 0)
    .map((entry) => [entry.module, entry.tools]),
)
const allDefined = [...defined.values()].flat()

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

/**
 * The fields one row's configuration schema accepts, read from its syntax tree:
 * a `Schema.object` shape is what `cordis.yml` may set, so a field added there
 * and nowhere else is exactly the kind that goes undocumented.
 */
export function fieldsIn(file: string, text: string): string[] {
  const source = parseSource(file, text)
  const found: string[] = []
  const visitor = new Visitor({
    CallExpression: (node) => {
      if (node.callee.type !== 'MemberExpression') return
      const object = node.callee.object
      const property = node.callee.property
      if (object.type !== 'Identifier' || object.name !== 'Schema') return
      if (property.type !== 'Identifier' || property.name !== 'object') return
      const shape = node.arguments[0]
      if (shape === undefined || shape.type !== 'ObjectExpression') return
      for (const entry of shape.properties) {
        if (entry.type === 'Property' && entry.key.type === 'Identifier') found.push(entry.key.name)
      }
    },
  })
  visitor.visit(source.program)
  return found
}

/**
 * The row a plugin directory names, from its top-level `export const name`.
 * Read from the tree so a new configured row cannot be added without the page
 * having to account for it.
 */
export function rowNameIn(file: string, text: string): string | undefined {
  const source = parseSource(file, text)
  for (const statement of source.program.body) {
    if (statement.type !== 'ExportNamedDeclaration') continue
    const declaration = statement.declaration
    if (declaration === null || declaration.type !== 'VariableDeclaration') continue
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type === 'Identifier' &&
        declarator.id.name === 'name' &&
        declarator.init !== null &&
        declarator.init.type === 'Literal' &&
        typeof declarator.init.value === 'string'
      ) {
        return declarator.init.value
      }
    }
  }
  return undefined
}

/**
 * Every configured row in the tree: a file exporting a top-level `name` is a
 * plugin row, and its `Schema.object` is what `cordis.yml` may set — or, when
 * the row keeps its schema in a sibling module, the one its directory holds.
 * Discovered rather than listed, so adding a row adds an obligation to this
 * page instead of quietly escaping one.
 */
const configured = PACKAGE_SOURCES.flatMap(sourcesUnder)
  .map((file) => ({ file, row: rowNameIn(file, read(file)) }))
  .flatMap((entry) => {
    if (entry.row === undefined) return []
    const own = fieldsIn(entry.file, read(entry.file))
    const fields =
      own.length > 0 ? own : sourcesUnder(directoryOf(entry.file)).flatMap((file) => fieldsIn(file, read(file)))
    return fields.length > 0 ? [{ row: entry.row, fields }] : []
  })
  .toSorted((left, right) => left.row.localeCompare(right.row))

/**
 * Every row the page gives a configuration table, in name order. Walked line by
 * line rather than matched as a section: under the multiline flag `$` ends at
 * every line, so a lazy section pattern stops at the heading itself and finds
 * nothing — silently, which is the failure mode this whole suite exists for.
 */
const documentedRows = (): string[] => {
  const found: string[] = []
  let row: string | undefined
  let table = false
  const close = (): void => {
    if (row !== undefined && table) found.push(row)
  }
  for (const line of readme.split('\n')) {
    if (line.startsWith('## ') || line.startsWith('### ')) {
      close()
      row = /^#{2,3} `([a-z0-9-]+)`/.exec(line)?.[1]
      table = false
    } else if (line.startsWith('| Field ')) {
      table = true
    }
  }
  close()
  return found.toSorted()
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

describe('the tool scanner', () => {
  // The scanner is proven on snippets before it is trusted on the tree.
  it('reads the name of a defined tool', () => {
    expect(
      toolsIn('m.ts', "ctx.tools.register(defineTool({ name: 'cloudflare_x', description: 'd' }))"),
    ).toEqual(['cloudflare_x'])
  })

  it('reads every tool in a module', () => {
    expect(
      toolsIn('m.ts', ["defineTool({ name: 'cloudflare_a' })", "defineTool({ name: 'cloudflare_b' })"].join('\n')),
    ).toEqual(['cloudflare_a', 'cloudflare_b'])
  })

  it('counts no name outside a tool definition', () => {
    // An output schema describes a field called `name`; a description quotes a
    // tool. Neither registers anything.
    expect(
      toolsIn('m.ts', ["const output = { name: 'cloudflare_not_a_tool' }", "other({ name: 'cloudflare_x' })"].join('\n')),
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

/** What the tree holds, as a plain object a failure prints legibly. */
const measuredCounts = (): Record<string, string> =>
  Object.fromEntries([...defined].map(([module, tools]) => [module, String(tools.length)]))

/** What a pattern claims, keyed the same way, so a missing claim is a missing key. */
const statedCounts = (pattern: RegExp): Record<string, string> =>
  Object.fromEntries(claimed(readme, pattern).map((groups) => [groups[0] ?? '', groups[1] ?? '']))

describe('every stated count is the measured one', () => {
  it('heads each catalogue section with the number of tools in that module', () => {
    expect(statedCounts(/^### .* — `cloudflare-dsh\/tools\/([a-z0-9-]+)` \((\d+)\)$/gm)).toEqual(
      measuredCounts(),
    )
  })

  it('labels each module in the architecture diagram with the same number', () => {
    expect(statedCounts(/tools\/([a-z0-9-]+) — (\d+) tools/g)).toEqual(measuredCounts())
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

  it('reads the row a plugin directory names', () => {
    expect(rowNameIn('p.ts', "export const name = 'a-row'\nconst name2 = 'not-it'")).toBe('a-row')
  })

  it('reads no row from a name that is not exported at the top level', () => {
    expect(rowNameIn('p.ts', "function f() {\n  const name = 'inner'\n  return name\n}")).toBeUndefined()
  })

  it('gives every configured row a table, and tables to nothing else', () => {
    expect(documentedRows()).toEqual(configured.map((row) => row.row).toSorted())
  })

  it('documents every field each configured row accepts, and invents none', () => {
    // One labelled expectation per row: a failure names the row whose table
    // drifted, which is the same report a generated case would give.
    for (const entry of configured) {
      expect(fieldsDocumented(sectionFor(entry.row)).toSorted(), entry.row).toEqual(entry.fields.toSorted())
    }
  })
})

describe('the lists this suite derives from the tree', () => {
  /**
   * Each derived list, and what it must contain.
   *
   * Every check below filters one of these and asserts the filter came back
   * empty, or walks it with a labelled expectation — and an empty list
   * satisfies both shapes without reading a thing. `allDefined` and the
   * diagram list already carry a guard of their own; these did not.
   *
   * Membership rather than a floor: a count drifts with the tree, while a
   * `configured` that stopped matching an exported `name`, or a commitments
   * table that stopped parsing, loses a specific row that can be named.
   */
  it('finds every configured row the tree exports', () => {
    expect(configured.map((row) => row.row).toSorted()).toEqual([
      'cloudflare',
      'cloudflare-llm',
      'cloudflare-tools-ai',
      'cloudflare-tools-data',
      'cloudflare-tools-meta',
      'cloudflare-tools-web',
    ])
    // Seven rows export a `name`; the client's takes no configuration, so it
    // has no schema and belongs to no table. Pinning six rather than seven says
    // that on purpose instead of leaving the difference to be rediscovered.
    expect(configured.map((row) => row.row)).not.toContain('cloudflare-client')
  })

  it('reads the markdown pages the diagram scan walks', () => {
    expect(markdown).toContain('README.md')
    expect(markdown).toContain('QUALITY-LOOP.md')
  })
})

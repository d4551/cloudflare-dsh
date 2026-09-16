/**
 * The Web Client surfaces gate: the slots the page documents.
 *
 * The client contributes into named slots a host assembles, and the page
 * documents them in a table. A slot added to the client and not to the page is
 * a surface a host cannot discover; a slot on the page and not in the client is
 * a promise nothing ships.
 *
 * Both sides of that comparison are lists, and two empty lists are equal — a
 * section that stopped parsing and a client that stopped naming slots agree
 * perfectly. Each side is guarded below, so a deletion on either one fails here
 * instead of passing quietly.
 */
import { Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { parseModule } from '../parse.ts'
import { read } from './base.ts'

/** Every slot the client package names, read from its `*_SLOT` constants. */
export function slotsIn(file: string, text: string): string[] {
  const source = parseModule(file, text)
  const found: string[] = []
  const visitor = new Visitor({
    VariableDeclarator: (node) => {
      if (
        node.id.type === 'Identifier' &&
        node.id.name.endsWith('_SLOT') &&
        node.init !== null &&
        node.init.type === 'Literal' &&
        typeof node.init.value === 'string'
      ) {
        found.push(node.init.value)
      }
    },
  })
  visitor.visit(source.program)
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

describe('the Web Client surfaces', () => {
  const CLIENT = 'packages/client/src/index.ts'
  const HEADING = '## Web Client surfaces'
  const readme = read('README.md')

  it('reads the slots a package names', () => {
    // The scanner is proven on a snippet before it is trusted on the tree.
    expect(slotsIn('c.ts', "export const A_SLOT = 'one.two'\nconst other = 'three'")).toEqual(['one.two'])
  })

  it('finds the section of the page this gate reads', () => {
    // `slice` of a heading that moved returns an empty string, and an empty
    // section documents no slot at all — which is a passing comparison against
    // a client that names none.
    expect(readme).toContain(HEADING)
  })

  it('finds the slots the client contributes into', () => {
    // The other half of that pair: the comparison below is only a comparison
    // while the client still names something to compare against.
    expect(slotsIn(CLIENT, read(CLIENT)).length).toBeGreaterThan(0)
  })

  it('names every slot the client contributes into, and no other', () => {
    const section = readme.slice(
      readme.indexOf(HEADING),
      readme.indexOf('\n## ', readme.indexOf(HEADING) + 1),
    )
    expect([...new Set(slotsDocumented(section))].toSorted()).toEqual(
      slotsIn(CLIENT, read(CLIENT)).toSorted(),
    )
  })
})

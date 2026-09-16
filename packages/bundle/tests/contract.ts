import { expect, it } from 'vitest'
import type { ToolContract } from './data/contracts/shared.ts'
import type { Harness } from './harness.ts'

/**
 * One family's pinned contracts, under the name the report uses.
 *
 * A family is how a module groups its tools — by product area, not by file —
 * so a tool moving between files inside one family changes no contract.
 */
export type ContractFamily = readonly [string, Record<string, ToolContract>]

/**
 * Register the cases that hold one tool module against its pinned contracts.
 *
 * Called from inside a `describe` whose title names the module, so every
 * module's suite asserts the same things in the same order: the module
 * registers exactly the contracted names, no tool is pinned twice under two
 * families, every family pins at least one tool, and each contracted tool
 * exposes its pinned description, parameter schema and output schema — as its
 * own case, so a drift fails against the tool it belongs to rather than
 * against the whole table at once.
 */
export function contractSuite(h: Harness, families: readonly ContractFamily[]): void {
  const contract = Object.fromEntries(families.flatMap(([, family]) => Object.entries(family)))
  const names = families.flatMap(([, family]) => Object.keys(family))

  it('registers exactly the contracted tools', () => {
    expect(h.names().toSorted()).toEqual(Object.keys(contract).toSorted())
  })

  it('pins every family without overlap', () => {
    expect(new Set(names).size).toBe(names.length)
  })

  for (const [family, contracts] of families) {
    it(`pins at least one tool for ${family}`, () => {
      expect(Object.keys(contracts).length).toBeGreaterThan(0)
    })
  }

  for (const [name, entry] of Object.entries(contract)) {
    it(`${name} exposes its contracted description, parameter schema and output schema`, () => {
      expect(h.tool(name).description, `${name}: description`).toBe(entry.description)
      expect(h.tool(name).parameters, `${name}: parameters`).toStrictEqual(entry.parameters)
      expect(h.tool(name).output.schema, `${name}: output schema`).toStrictEqual(entry.output)
    })
  }
}

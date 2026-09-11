import { expect } from 'vitest'
import type { JsonValue } from '../../../src/tools/_shared/json.ts'
import type { Harness } from '../../harness.ts'

/**
 * The model-facing surface one data tool must expose, pinned verbatim.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation — so
 * they are written out in full on purpose: changing one has to be a deliberate
 * edit that shows up in review, which a re-recordable snapshot would not
 * guarantee.
 */
export interface ToolContract {
  readonly description: string
  readonly parameters: JsonValue
  readonly output: JsonValue
}

/** Assert one tool exposes exactly its contracted description and schemas. */
export function assertContract(h: Harness, name: string, contract: ToolContract): void {
  expect(h.tool(name).description, `${name}: description`).toBe(contract.description)
  expect(h.tool(name).parameters, `${name}: parameters`).toStrictEqual(contract.parameters)
  expect(h.tool(name).output.schema, `${name}: output schema`).toStrictEqual(contract.output)
}

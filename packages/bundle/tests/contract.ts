import { expect } from 'vitest'
import type { Harness } from './harness.ts'
import { assertContract, type ToolContract } from './data/contracts/shared.ts'

/**
 * The walk both contract suites share: every family's tools are asserted
 * against their pinned contracts in one loop, so a tool added tomorrow fails
 * until its contract is pinned, and a failure names its tool through the
 * labelled expectations. Returns the number of tools asserted so the caller
 * can pin the walk against the full contract map.
 */
export function assertEveryContract(
  h: Harness,
  families: readonly (readonly [string, Record<string, ToolContract>])[],
): number {
  let asserted = 0
  for (const [family, contracts] of families) {
    for (const [name, contract] of Object.entries(contracts)) {
      assertContract(h, name, contract)
      asserted += 1
    }
    expect(Object.keys(contracts).length, `${family}: pinned tools`).toBeGreaterThan(0)
  }
  return asserted
}

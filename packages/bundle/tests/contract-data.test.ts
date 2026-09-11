import { describe, expect, it } from 'vitest'
import * as dataTools from '../src/tools/data/index.ts'
import { envelope, makeHarness } from './harness.ts'
import { D1_CONTRACT } from './contracts/d1.ts'
import { KV_CONTRACT } from './contracts/kv.ts'
import { QUEUE_CONTRACT } from './contracts/queue.ts'
import { R2_CONTRACT } from './contracts/r2.ts'
import { assertContract, type ToolContract } from './contracts/shared.ts'

/** Every contracted data tool, by family. */
const FAMILIES: [string, Record<string, ToolContract>][] = [
  ['D1', D1_CONTRACT],
  ['KV', KV_CONTRACT],
  ['Queues', QUEUE_CONTRACT],
  ['R2', R2_CONTRACT],
]

const CONTRACT: Record<string, ToolContract> = Object.fromEntries(
  FAMILIES.flatMap(([, family]) => Object.entries(family)),
)

describe('data tool contract', () => {
  const h = makeHarness(dataTools, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect(h.names().toSorted()).toEqual(Object.keys(CONTRACT).toSorted())
  })

  // The walk is a loop over the contract rather than a generated case list,
  // so a tool added tomorrow fails here until its contract is pinned; a
  // failure names its tool through the labelled expectations.
  it('every tool exposes its contracted description, parameter schema, and output schema', () => {
    for (const [name, contract] of Object.entries(CONTRACT)) {
      assertContract(h, name, contract)
    }
  })

  it('pins every family without overlap', () => {
    const names = FAMILIES.flatMap(([, family]) => Object.keys(family))
    expect(new Set(names).size).toBe(names.length)
  })
})

import { describe, expect, it } from 'vitest'
import * as dataTools from '../src/tools/data/index.ts'
import { envelope, makeHarness } from './harness.ts'
import { assertEveryContract } from './contract.ts'
import { D1_CONTRACT } from './data/contracts/d1.ts'
import { KV_CONTRACT } from './data/contracts/kv.ts'
import { QUEUE_CONTRACT } from './data/contracts/queue.ts'
import { R2_CONTRACT } from './data/contracts/r2.ts'
import type { ToolContract } from './data/contracts/shared.ts'

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

  it('every tool exposes its contracted description, parameter schema, and output schema', () => {
    expect(assertEveryContract(h, FAMILIES)).toBe(Object.keys(CONTRACT).length)
  })

  it('pins every family without overlap', () => {
    const names = FAMILIES.flatMap(([, family]) => Object.keys(family))
    expect(new Set(names).size).toBe(names.length)
  })
})

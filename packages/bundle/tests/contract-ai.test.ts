import { describe, expect, it } from 'vitest'
import * as aiTools from '../src/tools/ai/index.ts'
import { envelope, makeHarness } from './harness.ts'
import { assertEveryContract } from './contract.ts'
import { AISEARCH_CONTRACT } from './ai/contracts/aisearch.ts'
import { GATEWAY_CONTRACT } from './ai/contracts/gateway.ts'
import { RUN_CONTRACT } from './ai/contracts/run.ts'
import { VECTORIZE_CONTRACT } from './ai/contracts/vectorize.ts'
import type { ToolContract } from './data/contracts/shared.ts'

/** Every contracted AI tool, by family. */
const FAMILIES: [string, Record<string, ToolContract>][] = [
  ['AI run and catalogue', RUN_CONTRACT],
  ['AI Gateway', GATEWAY_CONTRACT],
  ['AI Search', AISEARCH_CONTRACT],
  ['Vectorize', VECTORIZE_CONTRACT],
]

const CONTRACT: Record<string, ToolContract> = Object.fromEntries(
  FAMILIES.flatMap(([, family]) => Object.entries(family)),
)

describe('ai tool contract', () => {
  const h = makeHarness(aiTools, async () => envelope(null))

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

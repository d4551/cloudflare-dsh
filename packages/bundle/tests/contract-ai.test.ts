import { describe } from 'vitest'
import { contractSuite, type ContractFamily } from './contract.ts'
import { AISEARCH_CONTRACT } from './ai/contracts/aisearch.ts'
import { GATEWAY_CONTRACT } from './ai/contracts/gateway.ts'
import { RUN_CONTRACT } from './ai/contracts/run.ts'
import { VECTORIZE_CONTRACT } from './ai/contracts/vectorize.ts'
import { envelope, makeHarness } from './harness.ts'
import * as aiTools from '../src/tools/ai/index.ts'

/** Every contracted AI tool, by family. */
const FAMILIES: ContractFamily[] = [
  ['AI run and catalogue', RUN_CONTRACT],
  ['AI Gateway', GATEWAY_CONTRACT],
  ['AI Search', AISEARCH_CONTRACT],
  ['Vectorize', VECTORIZE_CONTRACT],
]

describe('ai tool contract', () => {
  contractSuite(
    makeHarness(aiTools, async () => envelope(null)),
    FAMILIES,
  )
})

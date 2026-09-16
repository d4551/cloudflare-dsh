import { describe } from 'vitest'
import { contractSuite, type ContractFamily } from './contract.ts'
import { D1_CONTRACT } from './data/contracts/d1.ts'
import { KV_CONTRACT } from './data/contracts/kv.ts'
import { QUEUE_CONTRACT } from './data/contracts/queue.ts'
import { R2_CONTRACT } from './data/contracts/r2.ts'
import { envelope, makeHarness } from './harness.ts'
import * as dataTools from '../src/tools/data/index.ts'

/** Every contracted data tool, by family. */
const FAMILIES: ContractFamily[] = [
  ['D1', D1_CONTRACT],
  ['KV', KV_CONTRACT],
  ['Queues', QUEUE_CONTRACT],
  ['R2', R2_CONTRACT],
]

describe('data tool contract', () => {
  contractSuite(
    makeHarness(dataTools, async () => envelope(null)),
    FAMILIES,
  )
})

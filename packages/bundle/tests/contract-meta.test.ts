import { describe } from 'vitest'
import { contractSuite } from './contract.ts'
import type { ToolContract } from './data/contracts/shared.ts'
import { envelope, makeHarness } from './harness.ts'
import * as toolsModule from '../src/tools/meta.ts'

/**
 * The model-facing contract for every tool in this module.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation, so they
 * are pinned explicitly rather than left to drift. Written out in full on
 * purpose: changing one has to be a deliberate edit visible in review.
 */
const CONTRACT: Record<string, ToolContract> = {
  cloudflare_account_list: {
    description: 'List the Cloudflare accounts this API token can access.',
    parameters: {
      type: 'object',
      properties: {},
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        accounts: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: {
                type: 'string',
              },
              name: {
                type: 'string',
              },
            },
            required: ['id', 'name'],
          },
          description: 'Accounts, projected to id and name.',
        },
        truncated: {
          type: 'boolean',
          description: 'Whether the page ceiling cut the list short.',
        },
      },
      required: ['accounts', 'truncated'],
      description: 'Accounts the token can reach.',
    },
  },
  cloudflare_api: {
    description:
      'Call any Cloudflare REST endpoint under /client/v4 that this bundle does not wrap with a dedicated tool. Paths are relative to the API root, e.g. /accounts/{account_id}/hyperdrive/configs. Read-only unless the plugin is configured to permit mutations.',
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'HTTP method.',
          enum: ['GET', 'HEAD'],
        },
        path: {
          type: 'string',
          description: 'Path under /client/v4, starting with a slash.',
        },
        query: {
          type: 'object',
          description: 'Query string parameters.',
          additionalProperties: true,
        },
        body: {
          description: 'Request body for writing methods.',
        },
      },
      required: ['method', 'path'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        result: {
          description: 'The result field of the API envelope.',
        },
      },
      required: ['result'],
      description: 'The envelope result, whatever the endpoint returned.',
    },
  },
}

describe('meta tool contract', () => {
  contractSuite(
    makeHarness(toolsModule, async () => envelope(null)),
    [['meta', CONTRACT]],
  )
})

import { describe, expect, it } from 'vitest'
import * as dataTools from '../src/tools/data.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The model-facing contract for every data tool.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation — so
 * they are pinned explicitly here rather than left to drift. These are written
 * out in full on purpose: changing one has to be a deliberate edit that shows
 * up in review, which a re-recordable snapshot would not guarantee.
 */
const CONTRACT: Record<string, { description: string; parameters: unknown; output: unknown }> = {
  "cloudflare_d1_list": {
    description: "List the D1 databases in the Cloudflare account.",
    parameters: {
        "type": "object",
        "properties": {
          "perPage": {
            "type": "integer",
            "description": "Databases per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Databases with ids and names.",
        "additionalProperties": true
      },
  },
  "cloudflare_d1_query": {
    description: "Run SQL against a D1 database. Handles multi-statement SQL. Use params for bound values rather than string interpolation.",
    parameters: {
        "type": "object",
        "properties": {
          "databaseId": {
            "type": "string",
            "description": "D1 database id."
          },
          "sql": {
            "type": "string",
            "description": "SQL to execute."
          },
          "params": {
            "type": "array",
            "description": "Bound parameters for ? placeholders.",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "databaseId",
          "sql"
        ]
      },
    output: {
        "type": "object",
        "description": "Result sets with rows and metadata.",
        "additionalProperties": true
      },
  },
  "cloudflare_kv_delete": {
    description: "Delete one key, or several keys, from a Workers KV namespace.",
    parameters: {
        "type": "object",
        "properties": {
          "namespaceId": {
            "type": "string",
            "description": "KV namespace id."
          },
          "keys": {
            "type": "array",
            "description": "Keys to delete.",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "namespaceId",
          "keys"
        ]
      },
    output: {
        "type": "object",
        "description": "How many keys were deleted.",
        "additionalProperties": true
      },
  },
  "cloudflare_kv_get": {
    description: "Read one key from a Workers KV namespace. Returns the stored value as text.",
    parameters: {
        "type": "object",
        "properties": {
          "namespaceId": {
            "type": "string",
            "description": "KV namespace id."
          },
          "key": {
            "type": "string",
            "description": "Key to read."
          }
        },
        "required": [
          "namespaceId",
          "key"
        ]
      },
    output: {
        "type": "object",
        "description": "The stored value.",
        "additionalProperties": true
      },
  },
  "cloudflare_kv_list_keys": {
    description: "List keys in a Workers KV namespace. Returns a cursor for paging when more keys remain.",
    parameters: {
        "type": "object",
        "properties": {
          "namespaceId": {
            "type": "string",
            "description": "KV namespace id."
          },
          "prefix": {
            "type": "string",
            "description": "Only list keys starting with this prefix."
          },
          "limit": {
            "type": "integer",
            "description": "Maximum keys to return (default 1000)."
          }
        },
        "required": [
          "namespaceId"
        ]
      },
    output: {
        "type": "object",
        "description": "Keys and paging state.",
        "additionalProperties": true
      },
  },
  "cloudflare_kv_namespace_list": {
    description: "List the Workers KV namespaces in the Cloudflare account.",
    parameters: {
        "type": "object",
        "properties": {
          "perPage": {
            "type": "integer",
            "description": "Namespaces per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Namespaces with their ids and titles.",
        "additionalProperties": true
      },
  },
  "cloudflare_kv_put": {
    description: "Write one or more key/value pairs to a Workers KV namespace. Values are stored as text.",
    parameters: {
        "type": "object",
        "properties": {
          "namespaceId": {
            "type": "string",
            "description": "KV namespace id."
          },
          "entries": {
            "type": "array",
            "description": "Key/value pairs to write.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "key": {
                  "type": "string"
                },
                "value": {
                  "type": "string"
                }
              },
              "required": [
                "key",
                "value"
              ]
            }
          }
        },
        "required": [
          "namespaceId",
          "entries"
        ]
      },
    output: {
        "type": "object",
        "description": "How many pairs were written.",
        "additionalProperties": true
      },
  },
  "cloudflare_queue_ack": {
    description: "Acknowledge or retry messages pulled from a Cloudflare Queue, by lease id. Acknowledged messages are removed; retried messages become visible again.",
    parameters: {
        "type": "object",
        "properties": {
          "queueId": {
            "type": "string",
            "description": "Queue id."
          },
          "acks": {
            "type": "array",
            "description": "Lease ids to acknowledge.",
            "items": {
              "type": "string"
            }
          },
          "retries": {
            "type": "array",
            "description": "Lease ids to retry.",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "queueId"
        ]
      },
    output: {
        "type": "object",
        "description": "Counts acknowledged and retried.",
        "additionalProperties": true
      },
  },
  "cloudflare_queue_list": {
    description: "List the Cloudflare Queues in the account.",
    parameters: {
        "type": "object",
        "properties": {
          "perPage": {
            "type": "integer",
            "description": "Queues per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Queues with ids and names.",
        "additionalProperties": true
      },
  },
  "cloudflare_queue_pull": {
    description: "Pull a batch of messages from a Cloudflare Queue. Each message carries a lease_id that must be passed to cloudflare_queue_ack.",
    parameters: {
        "type": "object",
        "properties": {
          "queueId": {
            "type": "string",
            "description": "Queue id."
          },
          "batchSize": {
            "type": "integer",
            "description": "Messages to pull (default 10)."
          },
          "visibilityTimeoutMs": {
            "type": "integer",
            "description": "How long pulled messages stay invisible, in ms (default 30000, max 12 hours)."
          }
        },
        "required": [
          "queueId"
        ]
      },
    output: {
        "type": "object",
        "description": "Pulled messages with lease ids.",
        "additionalProperties": true
      },
  },
  "cloudflare_queue_send": {
    description: "Push one message onto a Cloudflare Queue.",
    parameters: {
        "type": "object",
        "properties": {
          "queueId": {
            "type": "string",
            "description": "Queue id."
          },
          "body": {
            "description": "Message payload."
          }
        },
        "required": [
          "queueId",
          "body"
        ]
      },
    output: {
        "type": "object",
        "description": "Send acknowledgement.",
        "additionalProperties": true
      },
  },
  "cloudflare_r2_bucket_create": {
    description: "Create an R2 bucket.",
    parameters: {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Bucket name."
          },
          "locationHint": {
            "type": "string",
            "description": "Preferred region hint, e.g. wnam, enam, weur, eeur, apac."
          }
        },
        "required": [
          "name"
        ]
      },
    output: {
        "type": "object",
        "description": "The created bucket.",
        "additionalProperties": true
      },
  },
  "cloudflare_r2_bucket_list": {
    description: "List the R2 buckets in the Cloudflare account.",
    parameters: {
        "type": "object",
        "properties": {
          "perPage": {
            "type": "integer",
            "description": "Buckets per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Buckets with names and creation dates.",
        "additionalProperties": true
      },
  },
}

describe('data tool contract', () => {
  const h = makeHarness(dataTools, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect([...h.tools.keys()].toSorted()).toEqual(Object.keys(CONTRACT).toSorted())
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted description', (name) => {
    expect(h.tool(name).description).toBe(CONTRACT[name]!.description)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted parameter schema', (name) => {
    expect(h.tool(name).parameters).toStrictEqual(CONTRACT[name]!.parameters)
  })

  it.each(Object.keys(CONTRACT))('%s exposes its contracted output schema', (name) => {
    expect(h.tool(name).output.schema).toStrictEqual(CONTRACT[name]!.output)
  })
})

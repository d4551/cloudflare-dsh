import { describe, expect, it } from 'vitest'
import * as toolsModule from '../src/tools/ai.ts'
import { envelope, makeHarness } from './harness.ts'

/**
 * The model-facing contract for every tool in this module.
 *
 * Descriptions and schemas are what the model reads to decide whether and how
 * to call a tool, and `additionalProperties` governs output validation, so they
 * are pinned explicitly rather than left to drift. Written out in full on
 * purpose: changing one has to be a deliberate edit visible in review.
 */
const CONTRACT: Record<string, { description: string; parameters: unknown; output: unknown }> = {
  "cloudflare_ai_model_schema": {
    description: "Fetch the JSON schema Cloudflare publishes for one Workers AI model, so cloudflare_ai_run can be called with the right input shape.",
    parameters: {
        "type": "object",
        "properties": {
          "model": {
            "type": "string",
            "description": "Model slug."
          }
        },
        "required": [
          "model"
        ]
      },
    output: {
        "type": "object",
        "description": "The model\u2019s published JSON schema.",
        "additionalProperties": true
      },
  },
  "cloudflare_ai_models_search": {
    description: "Search the Workers AI model catalogue by name or task.",
    parameters: {
        "type": "object",
        "properties": {
          "search": {
            "type": "string",
            "description": "Substring to match against model names."
          },
          "task": {
            "type": "string",
            "description": "Task filter, e.g. \"Text Generation\"."
          },
          "perPage": {
            "type": "integer",
            "description": "Models per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Matching models.",
        "additionalProperties": true
      },
  },
  "cloudflare_ai_run": {
    description: "Run a Workers AI model. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape.",
    parameters: {
        "type": "object",
        "properties": {
          "model": {
            "type": "string",
            "description": "Model slug, e.g. @cf/meta/llama-3.1-8b-instruct."
          },
          "input": {
            "description": "Model input, matching that model\u2019s schema."
          }
        },
        "required": [
          "model",
          "input"
        ]
      },
    output: {
        "type": "object",
        "description": "The model output.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_cost": {
    description: "Read AI Gateway billing: the prepaid credit balance, usage history, or the current invoice preview.",
    parameters: {
        "type": "object",
        "properties": {
          "view": {
            "type": "string",
            "description": "Which billing view to read.",
            "enum": [
              "credit-balance",
              "usage-history",
              "invoice-preview"
            ]
          }
        },
        "required": [
          "view"
        ]
      },
    output: {
        "type": "object",
        "description": "The requested billing view.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_get": {
    description: "Fetch one AI Gateway\u2019s configuration.",
    parameters: {
        "type": "object",
        "properties": {
          "gatewayId": {
            "type": "string",
            "description": "Gateway id."
          }
        },
        "required": [
          "gatewayId"
        ]
      },
    output: {
        "type": "object",
        "description": "The gateway configuration.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_list": {
    description: "List the AI Gateways in the Cloudflare account.",
    parameters: {
        "type": "object",
        "properties": {
          "perPage": {
            "type": "integer",
            "description": "Gateways per page (default 50)."
          }
        }
      },
    output: {
        "type": "object",
        "description": "Gateways with their ids and settings.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_log_body": {
    description: "Fetch the stored request or response body for one AI Gateway log entry.",
    parameters: {
        "type": "object",
        "properties": {
          "gatewayId": {
            "type": "string",
            "description": "Gateway id."
          },
          "logId": {
            "type": "string",
            "description": "Log entry id."
          },
          "part": {
            "type": "string",
            "description": "Which body to fetch.",
            "enum": [
              "request",
              "response"
            ]
          }
        },
        "required": [
          "gatewayId",
          "logId",
          "part"
        ]
      },
    output: {
        "type": "object",
        "description": "The stored body.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_logs": {
    description: "Query AI Gateway request logs. Filter by metadata to isolate one harness session: requests made through the Cloudflare model provider carry the session id in cf-aig-metadata.",
    parameters: {
        "type": "object",
        "properties": {
          "gatewayId": {
            "type": "string",
            "description": "Gateway id."
          },
          "perPage": {
            "type": "integer",
            "description": "Log entries per page (default 50)."
          },
          "filters": {
            "type": "object",
            "description": "Extra query filters, e.g. { \"metadata.sessionId\": \"...\" }.",
            "additionalProperties": true
          }
        },
        "required": [
          "gatewayId"
        ]
      },
    output: {
        "type": "object",
        "description": "Matching log entries.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_routes": {
    description: "List the dynamic routing rules configured on an AI Gateway.",
    parameters: {
        "type": "object",
        "properties": {
          "gatewayId": {
            "type": "string",
            "description": "Gateway id."
          }
        },
        "required": [
          "gatewayId"
        ]
      },
    output: {
        "type": "object",
        "description": "Dynamic routes.",
        "additionalProperties": true
      },
  },
  "cloudflare_aigateway_session_cost": {
    description: "Summarise what one harness session cost through AI Gateway, by reading the gateway logs tagged with that session id.",
    parameters: {
        "type": "object",
        "properties": {
          "gatewayId": {
            "type": "string",
            "description": "Gateway id."
          },
          "sessionId": {
            "type": "string",
            "description": "Harness session id."
          },
          "perPage": {
            "type": "integer",
            "description": "Log entries to scan (default 100)."
          }
        },
        "required": [
          "gatewayId",
          "sessionId"
        ]
      },
    output: {
        "type": "object",
        "description": "Request count, total cost, tokens, and cache hits for the session.",
        "additionalProperties": true
      },
  },
  "cloudflare_aisearch_chat": {
    description: "Ask an AI Search instance a question and get an answer grounded in its indexed content.",
    parameters: {
        "type": "object",
        "properties": {
          "instanceId": {
            "type": "string",
            "description": "AI Search instance id."
          },
          "query": {
            "type": "string",
            "description": "Question to answer."
          },
          "model": {
            "type": "string",
            "description": "Override the generating model."
          }
        },
        "required": [
          "instanceId",
          "query"
        ]
      },
    output: {
        "type": "object",
        "description": "The grounded completion.",
        "additionalProperties": true
      },
  },
  "cloudflare_aisearch_search": {
    description: "Search an AI Search instance (formerly AutoRAG) and return the matching chunks, without generating an answer.",
    parameters: {
        "type": "object",
        "properties": {
          "instanceId": {
            "type": "string",
            "description": "AI Search instance id."
          },
          "query": {
            "type": "string",
            "description": "Search query."
          },
          "maxResults": {
            "type": "integer",
            "description": "Maximum chunks to return (default 10)."
          }
        },
        "required": [
          "instanceId",
          "query"
        ]
      },
    output: {
        "type": "object",
        "description": "Matching chunks.",
        "additionalProperties": true
      },
  },
  "cloudflare_aisearch_sync": {
    description: "Trigger an indexing job for an AI Search instance so new source content is picked up.",
    parameters: {
        "type": "object",
        "properties": {
          "instanceId": {
            "type": "string",
            "description": "AI Search instance id."
          }
        },
        "required": [
          "instanceId"
        ]
      },
    output: {
        "type": "object",
        "description": "The created sync job.",
        "additionalProperties": true
      },
  },
  "cloudflare_vectorize_index_list": {
    description: "List the Vectorize indexes in the Cloudflare account.",
    parameters: {
        "type": "object",
        "properties": {}
      },
    output: {
        "type": "object",
        "description": "Vectorize indexes.",
        "additionalProperties": true
      },
  },
  "cloudflare_vectorize_query": {
    description: "Query a Vectorize index by vector and return the nearest matches.",
    parameters: {
        "type": "object",
        "properties": {
          "indexName": {
            "type": "string",
            "description": "Index name."
          },
          "vector": {
            "type": "array",
            "description": "Query vector.",
            "items": {
              "type": "number"
            }
          },
          "topK": {
            "type": "integer",
            "description": "How many matches to return (default 5)."
          },
          "returnValues": {
            "type": "boolean",
            "description": "Include stored vectors in the response."
          },
          "returnMetadata": {
            "type": "boolean",
            "description": "Include stored metadata in the response."
          }
        },
        "required": [
          "indexName",
          "vector"
        ]
      },
    output: {
        "type": "object",
        "description": "Nearest matches.",
        "additionalProperties": true
      },
  },
}

describe('ai tool contract', () => {
  const h = makeHarness(toolsModule, async () => envelope(null))

  it('registers exactly the contracted tools', () => {
    expect([...h.tools.keys()].sort()).toEqual(Object.keys(CONTRACT).sort())
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

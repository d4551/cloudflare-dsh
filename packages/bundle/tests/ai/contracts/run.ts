import type { ToolContract } from '../../data/contracts/shared.ts'

/** The contracted surface of the Workers AI execution and catalogue tools. */
export const RUN_CONTRACT: Record<string, ToolContract> = {
  cloudflare_ai_model_schema: {
    description:
      'Fetch the JSON schema Cloudflare publishes for one Workers AI model, so cloudflare_ai_run can be called with the right input shape.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model slug.',
        },
      },
      required: ['model'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description: 'Model slug the schema describes.',
        },
        schema: {
          description: 'The JSON schema Cloudflare publishes for the model.',
        },
      },
      required: ['model', 'schema'],
      description: 'The model and its published JSON schema.',
    },
  },
  cloudflare_ai_models_search: {
    description:
      'Search the Workers AI model catalogue by name or task, one page at a time. The catalogue reports no total, so a full page means more may follow.',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Substring to match against model names.',
        },
        task: {
          type: 'string',
          description: 'Task filter, e.g. "Text Generation".',
        },
        page: {
          type: 'integer',
          description: 'Page number, from 1; the first page when omitted.',
        },
        perPage: {
          type: 'integer',
          description: 'Models per page (default 50).',
        },
      },
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        models: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
          description: 'Catalogue entries as the API returns them.',
        },
        page: {
          type: 'integer',
          description: 'The page this is.',
        },
        perPage: {
          type: 'integer',
          description: 'Items requested per page.',
        },
        total: {
          oneOf: [{ type: 'integer' }, { type: 'null' }],
          description: 'Items the API says exist in all; null when it did not say.',
        },
        complete: {
          type: 'boolean',
          description:
            'Whether this page is the last: certain when the total is known, inferred from a short page otherwise.',
        },
      },
      required: ['models', 'page', 'perPage', 'total', 'complete'],
      description: 'One page of model catalogue entries, and where it sits in the whole.',
    },
  },
  cloudflare_ai_run: {
    description:
      'Run a Workers AI model and return its complete response. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape. Streaming belongs to the cloudflare-workers-ai model provider, so an input with stream: true is refused.',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model slug, e.g. @cf/meta/llama-3.1-8b-instruct.',
        },
        input: {
          description: 'Model input, matching that model’s schema.',
        },
      },
      required: ['model', 'input'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        model: {
          type: 'string',
          description: 'Model slug that produced the output.',
        },
        output: {
          description: 'The model output as Workers AI returned it.',
        },
      },
      required: ['model', 'output'],
      description: 'The model that ran and what it returned.',
    },
  },
}

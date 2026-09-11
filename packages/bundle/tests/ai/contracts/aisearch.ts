import type { ToolContract } from '../../data/contracts/shared.ts'

/** The contracted surface of the AI Search tools. */
export const AISEARCH_CONTRACT: Record<string, ToolContract> = {
  cloudflare_aisearch_chat: {
    description: 'Ask an AI Search instance a question and get an answer grounded in its indexed content.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
        query: {
          type: 'string',
          description: 'Question to answer.',
        },
        model: {
          type: 'string',
          description: 'Override the generating model.',
        },
      },
      required: ['instanceId', 'query'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: {
          description: 'The answer payload as the API returns it.',
        },
      },
      required: ['answer'],
      description: 'The grounded answer.',
    },
  },
  cloudflare_aisearch_search: {
    description:
      'Search an AI Search instance (formerly AutoRAG) and return the matching chunks, without generating an answer.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
        query: {
          type: 'string',
          description: 'Search query.',
        },
        maxResults: {
          type: 'integer',
          description: 'Maximum chunks to return (default 10).',
        },
      },
      required: ['instanceId', 'query'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        results: {
          description: 'Search results as the API returns them.',
        },
      },
      required: ['results'],
      description: 'Matching chunks.',
    },
  },
  cloudflare_aisearch_sync: {
    description: 'Trigger an indexing job for an AI Search instance so new source content is picked up.',
    parameters: {
      type: 'object',
      properties: {
        instanceId: {
          type: 'string',
          description: 'AI Search instance id.',
        },
      },
      required: ['instanceId'],
    },
    output: {
      type: 'object',
      additionalProperties: false,
      properties: {
        job: {
          description: 'The job record as the API returns it.',
        },
      },
      required: ['job'],
      description: 'The sync job that was started.',
    },
  },
}

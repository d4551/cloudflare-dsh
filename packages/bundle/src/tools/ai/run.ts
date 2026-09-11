/**
 * Workers AI tools: run a model, search the catalogue, read a model's schema.
 *
 * Registration only. Every path and query decision lives in
 * `../../specs/ai.ts` as a pure function, and every rendering decision in
 * `../_shared/render.ts`, so this module stays a thin, declarative layer.
 */
import type { CloudflareService } from '@d4551/dsh-cloudflare-core'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { aiModelSchemaSpec, aiModelsSearchSpec, aiRunSpec } from '../../specs/ai.ts'
import {
  PAGE_OUTCOME_PROPERTIES,
  PAGE_PARAMETER,
  pageNote,
  pageOutcome,
  requestedPage,
} from '../_shared/paging.ts'
import { isObject, type JsonValue } from '../_shared/json.ts'
import { json, listing } from '../_shared/render.ts'
import type { AiToolsConfig } from './config.ts'
import { AiRunStreamError } from './stream.ts'

/** Register the Workers AI tools on the harness tool registry. */
export function registerWorkersAi(ctx: Context, cf: CloudflareService, config: AiToolsConfig): void {
  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_run',
      description:
        'Run a Workers AI model and return its complete response. The model is a slug such as @cf/meta/llama-3.1-8b-instruct; use cloudflare_ai_models_search to find one and cloudflare_ai_model_schema for its exact input shape. Streaming belongs to the cloudflare-workers-ai model provider, so an input with stream: true is refused.',
      parameters: {
        model: {
          type: 'string',
          required: true,
          description: 'Model slug, e.g. @cf/meta/llama-3.1-8b-instruct.',
        },
        input: { type: 'json', required: true, description: 'Model input, matching that model’s schema.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The model that ran and what it returned.',
          properties: {
            model: { type: 'string', required: true, description: 'Model slug that produced the output.' },
            output: {
              type: 'json',
              required: true,
              description: 'The model output as Workers AI returned it.',
            },
          },
        },
        render: (_args, value) => json(value.output),
      },
      timeoutMs: config.inferenceTimeoutMs,
      async execute(args, exec) {
        // A streamed response is SSE, not the envelope this tool reads; refusing
        // it names the alternative instead of failing on the body shape.
        if (isObject(args.input) && args.input.stream === true) throw new AiRunStreamError()
        const output = await cf.accountRequest<JsonValue>({
          ...aiRunSpec(args.model, args.input),
          signal: exec.signal,
          timeoutMs: config.inferenceTimeoutMs,
        })
        return { model: args.model, output }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_models_search',
      description:
        'Search the Workers AI model catalogue by name or task, one page at a time. The catalogue reports no total, so a full page means more may follow.',
      parameters: {
        search: { type: 'string', description: 'Substring to match against model names.' },
        task: { type: 'string', description: 'Task filter, e.g. "Text Generation".' },
        ...PAGE_PARAMETER,
        perPage: { type: 'integer', description: `Models per page (default ${config.pageSize}).` },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'One page of model catalogue entries, and where it sits in the whole.',
          properties: {
            models: {
              type: 'array',
              required: true,
              description: 'Catalogue entries as the API returns them.',
              items: { type: 'object', additionalProperties: true },
            },
            ...PAGE_OUTCOME_PROPERTIES,
          },
        },
        render: (_args, value) => listing(value.models.length, 'model', value, pageNote(value)),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const page = requestedPage(args.page)
        const perPage = args.perPage ?? config.pageSize
        const envelope = await cf.accountRequestEnvelope<Record<string, JsonValue>[]>({
          ...aiModelsSearchSpec(args.search, args.task, page, perPage),
          signal: exec.signal,
        })
        return {
          models: envelope.result,
          ...pageOutcome(envelope.result_info, page, perPage, envelope.result.length),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'cloudflare_ai_model_schema',
      description:
        'Fetch the JSON schema Cloudflare publishes for one Workers AI model, so cloudflare_ai_run can be called with the right input shape.',
      parameters: { model: { type: 'string', required: true, description: 'Model slug.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          description: 'The model and its published JSON schema.',
          properties: {
            model: { type: 'string', required: true, description: 'Model slug the schema describes.' },
            schema: {
              type: 'json',
              required: true,
              description: 'The JSON schema Cloudflare publishes for the model.',
            },
          },
        },
        render: (_args, value) => json(value.schema),
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const schema = await cf.accountRequest<JsonValue>({
          ...aiModelSchemaSpec(args.model),
          signal: exec.signal,
        })
        return { model: args.model, schema }
      },
    }),
  )
}

/**
 * Test harness: a Cordis context wired with a real CloudflareService and the
 * real tool registry, so tools are driven through the same pipeline the agent
 * loop uses — argument validation, execution, output validation against the
 * declared schema, freezing, rendering — without a network.
 */
import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import {
  ToolRuntime,
  validateJsonSchemaValue,
  type ToolDefinition,
  type ToolExecutionResult,
  type ToolFailure,
} from '@deepseek-ai/dsh-tools'
import { expect } from 'vitest'
import type { JsonValue } from '../src/tools/_shared/json.ts'

/** JSON response helper matching the Cloudflare envelope. */
export function envelope<T>(result: T, resultInfo?: Record<string, number | string>): Response {
  // `result_info` is optional so an existing fixture stays a single page, but
  // it has to be expressible: without it no test could exercise a paged walk
  // at all.
  const body =
    resultInfo === undefined
      ? { success: true, errors: [], messages: [], result }
      : {
          success: true,
          errors: [],
          messages: [],
          result,
          result_info: resultInfo,
        }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** An error envelope. */
export function failure(code: number, message: string, status = 400): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors: [{ code, message }],
      messages: [],
      result: null,
    }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

/**
 * A tool run the registry materialized as a failure. The message is the one
 * the model would read; `failure` is the whole record, including the
 * `info` the registry attaches to harness-classified errors.
 */
class ToolRunError extends Error {
  override readonly name = 'ToolRunError'
  readonly failure: ToolFailure

  constructor(record: ToolFailure) {
    super(record.message)
    this.failure = record
  }
}

export interface Harness {
  readonly requests: Request[]
  /** Every tool the plugin registered, by name. */
  names(): string[]
  tool(name: string): ToolDefinition
  /**
   * Execute one call through the real registry and return the result the
   * agent loop would receive, error or success.
   */
  execute(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolExecutionResult>
  /**
   * Execute one call and resolve its canonical value, which has passed
   * validation against the tool's declared output schema; a failure rejects
   * with {@link ToolRunError}.
   */
  run(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
  /**
   * Render a hand-built value. The registry renders only values that passed
   * output validation, so the value (and the arguments) must satisfy the
   * declared schemas first; a test cannot render a shape the tool never
   * produces.
   */
  render(name: string, args: Record<string, unknown>, value: JsonValue): ContentBlock[]
}

/** Build a harness around one tool-registering plugin. */
export function makeHarness<C>(
  plugin: { apply(ctx: Context, config: C): void; Config(input: Partial<C>): C },
  fetchImpl: (request: Request) => Promise<Response>,
  config: Partial<Parameters<typeof CloudflareConfig>[0]> = {},
  pluginConfig: Partial<C> = {},
): Harness {
  const requests: Request[] = []
  const ctx = new Context()

  // The registry injects the system-prompt service to publish tool guidance.
  // There is no prompt here, so the three members it calls are inert.
  ctx.provide('systemPrompt', {
    section: () => () => {},
    getSectionOrder: () => 0,
    tools: () => () => {},
  })
  const tools = new ToolRuntime(ctx)
  const credentials = { resolve: () => 'tok' }
  ctx.provide('credentials', credentials)
  // Constructing the service registers it as `cloudflare` on the context;
  // providing it again would be a duplicate registration.
  const service = new CloudflareService(
    ctx,
    CloudflareConfig({
      accountId: 'a1',
      baseUrl: 'https://api.test/v4',
      ...config,
    }),
    {
      credentials,
      fetch: async (request) => {
        requests.push(request)
        return fetchImpl(request)
      },
    },
  )
  expect(service.name).toBe('cloudflare')
  plugin.apply(ctx, plugin.Config(pluginConfig))

  let calls = 0
  const execute = (name: string, args: Record<string, unknown>, signal = new AbortController().signal) => {
    calls += 1
    return tools.execute({ callId: ToolCallId(`call-${calls}`), name, arguments: args, signal })
  }

  return {
    requests,
    names: () => tools.schemas().map((schema) => schema.name),
    tool(name) {
      const found = tools.get(name)
      if (found === undefined) throw new Error(`tool ${name} was not registered`)
      return found
    },
    execute,
    async run(name, args, signal) {
      const result = await execute(name, args, signal)
      if (result.isError) throw new ToolRunError(result.error)
      return result.value
    },
    render(name, args, value) {
      const tool = this.tool(name)
      expect(validateJsonSchemaValue(tool.parameters, args, '')).toEqual([])
      expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
      return tool.output.render(args, value)
    },
  }
}

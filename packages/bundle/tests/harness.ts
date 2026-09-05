/**
 * Test harness: a Cordis context wired with a real CloudflareService and a
 * capturing tool registry, so tools can be driven end to end without a network.
 */
import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { expect } from 'vitest'

/** A minimal execution context; tools under test only read `signal`. */
const runContext = { signal: undefined } as unknown as ToolRunContext

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

interface Harness {
  readonly tools: Map<string, ToolDefinition>
  readonly requests: Request[]
  readonly ctx: Context
  tool(name: string): ToolDefinition
  /** Run a tool's execute, then its render, as the registry would. */
  run(name: string, args: Record<string, unknown>): Promise<unknown>
}

/** Build a harness around one tool-registering plugin. */
export function makeHarness<C>(
  plugin: { apply(ctx: Context, config: C): void; Config(input: Partial<C>): C },
  fetchImpl: (request: Request) => Promise<Response>,
  config: Partial<Parameters<typeof CloudflareConfig>[0]> = {},
  pluginConfig: Partial<C> = {},
): Harness {
  const requests: Request[] = []
  const tools = new Map<string, ToolDefinition>()
  const ctx = new Context()

  ctx.provide('tools', {
    register(definition: ToolDefinition) {
      tools.set(definition.name, definition)
      return () => tools.delete(definition.name)
    },
  })
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

  return {
    tools,
    requests,
    ctx,
    tool(name) {
      const found = tools.get(name)
      if (found === undefined) throw new Error(`tool ${name} was not registered`)
      return found
    },
    async run(name, args) {
      return this.tool(name).execute(args, runContext)
    },
  }
}

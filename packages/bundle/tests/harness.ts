/**
 * Test harness: a Cordis context wired with a real CloudflareService and the
 * real tool registry, so tools are driven through the same pipeline the agent
 * loop uses — argument validation, execution, output validation against the
 * declared schema, freezing, rendering — without a network.
 */
import { createHash } from 'node:crypto'
import { CloudflareConfig, CloudflareService } from '@d4551/dsh-cloudflare-core'
import { Context } from '@deepseek-ai/cordis'
import {
  AttachmentError,
  AttachmentId,
  AttachmentStore,
  type ImageAttachmentLimits,
  type ImageAttachmentRef,
  type SaveImageAttachment,
  type StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
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

/** A 1×1 PNG, the smallest image the screenshot tests can hand to the store. */
export const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
)

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Dimensions from a PNG's IHDR chunk, and 0×0 for anything else: a test double
 * does not decode images, and the real store verifies bytes against their type.
 */
function pngDimensions(data: Uint8Array): { width: number; height: number } {
  const isPng = data.length >= 24 && PNG_SIGNATURE.every((byte, index) => data[index] === byte)
  if (!isPng) return { width: 0, height: 0 }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/**
 * An in-memory attachment store: every saved image is kept and can be read
 * back, and its id is the digest of its bytes, as a content-addressed store's
 * would be. Constructing it registers it as `ctx.attachments`.
 */
export class MemoryAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 10_000_000,
    maxImagesPerMessage: 10,
    maxMessageImageBytes: 50_000_000,
    maxImagePixels: 100_000_000,
    maxImageDimension: 20_000,
    mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  }
  /** Every image handed to `saveImage`, in order. */
  readonly saved: SaveImageAttachment[] = []
  // A plain field: cordis hands the service out through a Proxy, which a `#private` field cannot cross.
  private readonly stored = new Map<string, StoredImageAttachment>()

  validateImage(): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input)
    const digest = createHash('sha256').update(input.data).digest('hex')
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId(`sha256:${digest}`),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      ...pngDimensions(input.data),
    }
    this.stored.set(ref.attachmentId, { ref, data: input.data })
    return Promise.resolve(ref)
  }

  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    const stored = this.stored.get(ref.attachmentId)
    if (stored === undefined) {
      return Promise.reject(
        new AttachmentError(`no image ${ref.attachmentId} was saved`, 'ATTACHMENT_NOT_FOUND'),
      )
    }
    return Promise.resolve(stored)
  }
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
  /** The attachment store the harness provided, or undefined when built without one. */
  readonly attachments: MemoryAttachmentStore | undefined
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
  /** `attachments: false` builds the composition without a store, the case where a screenshot must fail. */
  options: { readonly attachments?: boolean } = {},
): Harness {
  const requests: Request[] = []
  const ctx = new Context()
  const attachments = options.attachments === false ? undefined : new MemoryAttachmentStore(ctx)

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
    attachments,
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

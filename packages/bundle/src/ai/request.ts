/**
 * Harness request options to an OpenAI-compatible request body.
 *
 * Pure, so the whole mapping — role translation, tool-call round-tripping,
 * option rejection — is unit-testable without a provider.
 *
 * Tool-call arguments stay raw JSON strings in both directions: the harness
 * requires it, and re-parsing them here would lose whatever the model actually
 * emitted when it is not valid JSON.
 *
 * Every content block kind has a stated fate here. Text is sent. Tool calls and
 * tool results round-trip. Images are projected to the harness's deterministic
 * text through its own helper: inlining them would need the attachment store's
 * bytes, which this adapter is not wired to, and Cloudflare's OpenAI-compatible
 * endpoint accepts only data URLs for images in any case. Reasoning is the
 * model's earlier thinking; OpenAI-compatible reasoning APIs refuse it in input,
 * so it is left out by that rule rather than dropped by accident.
 */
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { projectImagesForTextModel } from '@deepseek-ai/dsh-llm'
import { unsupportedOption } from './errors.ts'

/** One tool call carried on an assistant message. */
interface WireToolCall {
  readonly id: string
  readonly type: 'function'
  readonly function: { readonly name: string; readonly arguments: string }
}

/** One message in the OpenAI-compatible wire format. */
export interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content?: string | null
  readonly tool_calls?: readonly WireToolCall[]
  readonly tool_call_id?: string
}

/** One tool exposed to the provider. */
export interface WireTool {
  readonly type: 'function'
  readonly function: { readonly name: string; readonly description: string; readonly parameters: unknown }
}

/** The request body sent to the provider. */
export interface WireRequest {
  readonly model: string
  readonly messages: readonly WireMessage[]
  readonly stream: true
  readonly stream_options: { readonly include_usage: true }
  readonly temperature?: number
  readonly max_tokens?: number
  readonly stop?: readonly string[]
  readonly tools?: readonly WireTool[]
}

/** Concatenate the text blocks of a message; reasoning is not text the provider may see again. */
export function textOf(content: readonly ContentBlock[]): string {
  return content.reduce((text, block) => (block.type === 'text' ? text + block.text : text), '')
}

/**
 * Translate one harness message into zero or more wire messages.
 *
 * A tool-result block becomes its own `role: 'tool'` message, which is how
 * OpenAI-compatible providers correlate results. Text carried beside the
 * results follows them as a message in the original role, so nothing the
 * message said is lost; the results come first because the provider expects
 * them directly after the assistant turn that called the tools.
 *
 * The wire has no field for `isError`: the registry writes a failed result's
 * content as `Error: …`, and that text reaches the provider verbatim.
 */
export function toWireMessages(message: Message): WireMessage[] {
  const text = textOf(message.content)
  const toolResults = message.content.filter((b) => b.type === 'tool-result')
  if (toolResults.length > 0) {
    const wire: WireMessage[] = toolResults.map((block) => ({
      role: 'tool',
      tool_call_id: block.toolCallId,
      content: textOf(block.content),
    }))
    if (text !== '') wire.push({ role: message.role, content: text })
    return wire
  }

  const toolCalls = message.content.filter((b) => b.type === 'tool-call')
  if (toolCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: text,
        tool_calls: toolCalls.map((block): WireToolCall => ({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: block.arguments },
        })),
      },
    ]
  }
  return [{ role: message.role, content: text }]
}

/** Translate harness tool schemas into the provider's `tools` field. */
export function toWireTools(tools: readonly ToolSchema[]): WireTool[] {
  return tools.map((tool): WireTool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/**
 * Build the request body.
 *
 * Any `GenerateOptions` field this route cannot express is rejected rather than
 * dropped: the harness is explicit that silently ignoring an option is not an
 * acceptable adapter behaviour.
 */
export function buildWireRequest(options: GenerateOptions): WireRequest {
  if (options.reasoningEffort !== undefined) {
    throw unsupportedOption('reasoningEffort', options.provider)
  }

  const messages: WireMessage[] = []
  if (options.system !== undefined && options.system !== '') {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of projectImagesForTextModel(options.messages)) {
    messages.push(...toWireMessages(message))
  }

  const tools = options.tools
  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.stop === undefined ? {} : { stop: options.stop }),
    ...(tools === undefined || tools.length === 0 ? {} : { tools: toWireTools(tools) }),
  }
}

/**
 * Harness request options to an OpenAI-compatible request body.
 *
 * Pure, so the whole mapping — role translation, tool-call round-tripping,
 * option rejection — is unit-testable without a provider.
 *
 * Tool-call arguments stay raw JSON strings in both directions: the harness
 * requires it, and re-parsing them here would lose whatever the model actually
 * emitted when it is not valid JSON.
 */
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { unsupportedOption } from './errors.ts'

/** One message in the OpenAI-compatible wire format. */
export interface WireMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content?: string | null
  readonly tool_calls?: readonly {
    readonly id: string
    readonly type: 'function'
    readonly function: { readonly name: string; readonly arguments: string }
  }[]
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

/** Concatenate the text-bearing blocks of a message. */
export function textOf(content: readonly ContentBlock[]): string {
  return content.reduce((text, block) => (block.type === 'text' ? text + block.text : text), '')
}

/**
 * Translate one harness message into zero or more wire messages.
 *
 * A tool-result block becomes its own `role: 'tool'` message, which is how
 * OpenAI-compatible providers expect results to be correlated.
 */
export function toWireMessages(message: Message): WireMessage[] {
  const toolResults = message.content.filter((b) => b.type === 'tool-result')
  if (toolResults.length > 0) {
    return toolResults.map((block) => ({
      role: 'tool' as const,
      tool_call_id: block.toolCallId,
      content: textOf(block.content),
    }))
  }

  const toolCalls = message.content.filter((b) => b.type === 'tool-call')
  if (toolCalls.length > 0) {
    return [
      {
        role: 'assistant',
        content: textOf(message.content),
        tool_calls: toolCalls.map((block) => ({
          id: block.id,
          type: 'function' as const,
          function: { name: block.name, arguments: block.arguments },
        })),
      },
    ]
  }
  return [{ role: message.role, content: textOf(message.content) }]
}

/** Translate harness tool schemas into the provider's `tools` field. */
export function toWireTools(tools: readonly ToolSchema[]): WireTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
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
  for (const message of options.messages) messages.push(...toWireMessages(message))

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

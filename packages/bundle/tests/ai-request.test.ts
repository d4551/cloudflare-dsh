import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, ToolCallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { UNSUPPORTED_OPTION_CODE } from '../src/ai/errors.ts'
import { buildWireRequest, textOf, toWireMessages, toWireTools } from '../src/ai/request.ts'

function message(role: Message['role'], content: ContentBlock[]): Message {
  return { id: 'm1' as Message['id'], role, content, source: {} as Message['source'] }
}

function options(over: Partial<GenerateOptions> = {}): GenerateOptions {
  return { provider: 'cloudflare-workers-ai', model: '@cf/m', messages: [], ...over }
}

describe('textOf', () => {
  it('concatenates text blocks', () => {
    expect(
      textOf([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab')
  })

  it('ignores non-text blocks', () => {
    expect(
      textOf([
        { type: 'text', text: 'a' },
        { type: 'tool-call', id: 'c' as ToolCallId, name: 'f', arguments: '{}' },
      ]),
    ).toBe('a')
  })

  it('returns an empty string for empty content', () => {
    expect(textOf([])).toBe('')
  })
})

describe('toWireMessages', () => {
  it('maps a plain user message', () => {
    expect(toWireMessages(message('user', [{ type: 'text', text: 'hi' }]))).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })

  it('preserves the assistant role', () => {
    expect(toWireMessages(message('assistant', [{ type: 'text', text: 'ok' }]))).toEqual([
      { role: 'assistant', content: 'ok' },
    ])
  })

  it('maps an assistant tool call, keeping arguments as a raw JSON string', () => {
    expect(
      toWireMessages(
        message('assistant', [
          { type: 'text', text: 'calling' },
          { type: 'tool-call', id: 'c1' as ToolCallId, name: 'search', arguments: '{"q":"x"}' },
        ]),
      ),
    ).toEqual([
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } }],
      },
    ])
  })

  it('maps several tool calls in one assistant message', () => {
    const wire = toWireMessages(
      message('assistant', [
        { type: 'tool-call', id: 'a' as ToolCallId, name: 'f', arguments: '{}' },
        { type: 'tool-call', id: 'b' as ToolCallId, name: 'g', arguments: '[]' },
      ]),
    )
    expect(wire[0]!.tool_calls).toHaveLength(2)
  })

  it('maps a tool result to its own tool-role message', () => {
    expect(
      toWireMessages(
        message('user', [
          { type: 'tool-result', toolCallId: 'c1' as ToolCallId, content: [{ type: 'text', text: 'done' }] },
        ]),
      ),
    ).toEqual([{ role: 'tool', tool_call_id: 'c1', content: 'done' }])
  })

  it('maps several tool results to separate messages', () => {
    expect(
      toWireMessages(
        message('user', [
          { type: 'tool-result', toolCallId: 'a' as ToolCallId, content: [] },
          { type: 'tool-result', toolCallId: 'b' as ToolCallId, content: [] },
        ]),
      ),
    ).toHaveLength(2)
  })

  it('prefers the tool-result mapping when a message carries both', () => {
    const wire = toWireMessages(
      message('user', [
        { type: 'tool-result', toolCallId: 'a' as ToolCallId, content: [] },
        { type: 'tool-call', id: 'b' as ToolCallId, name: 'f', arguments: '{}' },
      ]),
    )
    expect(wire).toEqual([{ role: 'tool', tool_call_id: 'a', content: '' }])
  })
})

describe('toWireTools', () => {
  it('maps a tool schema to the provider function shape', () => {
    const tools: ToolSchema[] = [
      { name: 'f', description: 'does f', parameters: { type: 'object', properties: {} } },
    ]
    expect(toWireTools(tools)).toEqual([
      {
        type: 'function',
        function: { name: 'f', description: 'does f', parameters: { type: 'object', properties: {} } },
      },
    ])
  })

  it('maps an empty list to an empty list', () => {
    expect(toWireTools([])).toEqual([])
  })
})

describe('buildWireRequest', () => {
  it('always streams and asks for usage', () => {
    const body = buildWireRequest(options())
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it('carries the model', () => {
    expect(buildWireRequest(options({ model: '@cf/x' })).model).toBe('@cf/x')
  })

  it('puts the system prompt first', () => {
    const body = buildWireRequest(
      options({ system: 'be terse', messages: [message('user', [{ type: 'text', text: 'hi' }])] }),
    )
    expect(body.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ])
  })

  it('omits an absent system prompt', () => {
    expect(buildWireRequest(options()).messages).toEqual([])
  })

  it('omits an empty system prompt rather than sending a blank turn', () => {
    expect(buildWireRequest(options({ system: '' })).messages).toEqual([])
  })

  it('includes temperature, max tokens and stop when given', () => {
    const body = buildWireRequest(options({ temperature: 0.2, maxTokens: 100, stop: ['\n\n'] }))
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(100)
    expect(body.stop).toEqual(['\n\n'])
  })

  it('omits them entirely when absent, leaving provider defaults alone', () => {
    const body = buildWireRequest(options())
    expect('temperature' in body).toBe(false)
    expect('max_tokens' in body).toBe(false)
    expect('stop' in body).toBe(false)
  })

  it('includes a zero temperature rather than treating it as absent', () => {
    expect(buildWireRequest(options({ temperature: 0 })).temperature).toBe(0)
  })

  it('includes tools when given', () => {
    const tools: ToolSchema[] = [{ name: 'f', description: 'd', parameters: {} }]
    expect(buildWireRequest(options({ tools })).tools).toHaveLength(1)
  })

  it('omits the tools field for an empty list', () => {
    expect('tools' in buildWireRequest(options({ tools: [] }))).toBe(false)
  })

  // The harness is explicit that an adapter must reject an option it cannot
  // express rather than silently dropping it.
  it('rejects reasoningEffort rather than dropping it', () => {
    const withEffort = { ...options(), reasoningEffort: ReasoningEffortId('high') }
    expect(() => buildWireRequest(withEffort)).toThrow(
      expect.objectContaining({ code: UNSUPPORTED_OPTION_CODE }),
    )
  })

  it('names the rejected option, so the message is actionable', () => {
    const withEffort = { ...options(), reasoningEffort: ReasoningEffortId('high') }
    expect(() => buildWireRequest(withEffort)).toThrow(/does not support the reasoningEffort option/)
  })
})

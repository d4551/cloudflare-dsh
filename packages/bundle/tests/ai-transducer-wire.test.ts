/**
 * The wire-chunk grammar: what a parsed SSE payload must be before the
 * transducer may read it.
 *
 * `isWireChunk` is the boundary the stream reads untrusted provider bytes
 * across, so every arm of the grammar is pinned here: a payload the predicate
 * accepts is one the transducer can read member by member without a further
 * check, and one it refuses is skipped rather than asserted into a shape.
 */
import { describe, expect, it } from 'vitest'
import type { JsonValue } from '@d4551/dsh-cloudflare-core/types'
import { parseJson } from '../src/ai/sse.ts'
import { isWireChunk } from '../src/ai/transducer.ts'

/** Read a JSON literal the way the stream reads one payload. */
function wire(text: string): JsonValue {
  const read = parseJson(text)
  if (!read.ok) throw new Error(`the fixture ${text} is not JSON`)
  return read.value
}

describe('isWireChunk', () => {
  it.each(['null', '[]', '[1]', '5', '"text"', 'true'])(
    'refuses a payload that is not an object: %s',
    (text) => {
      expect(isWireChunk(wire(text))).toBe(false)
    },
  )

  it.each([
    [
      'a choice with a delta and a finish reason',
      '{"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}',
    ],
    ['a choice whose finish reason is an explicit null', '{"choices":[{"delta":{},"finish_reason":null}]}'],
    ['a chunk with no choices at all', '{"usage":null}'],
    ['members the transducer never reads', '{"choices":[],"model":"gpt","created":1}'],
    ['content as a string', '{"choices":[{"delta":{"content":"x"}}]}'],
    ['content as an explicit null', '{"choices":[{"delta":{"content":null}}]}'],
    ['reasoning content as a string', '{"choices":[{"delta":{"reasoning_content":"r"}}]}'],
    ['reasoning content as an explicit null', '{"choices":[{"delta":{"reasoning_content":null}}]}'],
    ['a tool call with only its required index', '{"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}'],
    [
      'a tool call with every optional member',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","type":"function","function":{"name":"f","arguments":"{}"}}]}}]}',
    ],
    ['usage with numeric counts', '{"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}'],
    [
      'usage detail records carrying their counts',
      '{"usage":{"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":2}}}',
    ],
  ])('accepts %s', (_label, text) => {
    expect(isWireChunk(wire(text))).toBe(true)
  })

  it.each([
    ['choices that is not an array', '{"choices":5}'],
    ['a choice that is not an object', '{"choices":["x"]}'],
    ['a choice whose delta is not an object', '{"choices":[{"delta":5}]}'],
    ['a finish reason that is neither a string nor null', '{"choices":[{"finish_reason":5}]}'],
    ['content that is a number', '{"choices":[{"delta":{"content":5}}]}'],
    ['reasoning content that is a number', '{"choices":[{"delta":{"reasoning_content":5}}]}'],
    ['tool calls that is not an array', '{"choices":[{"delta":{"tool_calls":{}}}]}'],
    ['a tool call that is not an object', '{"choices":[{"delta":{"tool_calls":[5]}}]}'],
    ['a tool call without a numeric index', '{"choices":[{"delta":{"tool_calls":[{}]}}]}'],
    ['a tool call id that is not a string', '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":5}]}}]}'],
    [
      'a tool call type that is not a string',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"type":5}]}}]}',
    ],
    ['a function that is not an object', '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":5}]}}]}'],
    [
      'a function name that is not a string',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":5}}]}}]}',
    ],
    [
      'function arguments that are not a string',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":5}}]}}]}',
    ],
    ['usage that is not an object', '{"usage":5}'],
    ['a count that is not a number', '{"usage":{"prompt_tokens":"1"}}'],
    ['a detail record that is not an object', '{"usage":{"prompt_tokens_details":5}}'],
    [
      'a detail count that is not a number',
      '{"usage":{"completion_tokens_details":{"reasoning_tokens":"2"}}}',
    ],
  ])('refuses %s', (_label, text) => {
    expect(isWireChunk(wire(text))).toBe(false)
  })
})

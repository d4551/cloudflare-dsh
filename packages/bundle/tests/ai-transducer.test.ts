/**
 * The chunk state machine: what one stream of wire events becomes.
 *
 * Every case here drives a real `StreamTransducer` from fixture events and
 * asserts the exact chunk sequence, because the ordering guarantees —
 * `usage` before `finish`, nothing after `finish`, blocks closed in index
 * order — are what the harness's turn loop depends on. The two pure value
 * mappings the same module exports are held by `ai-transducer-mapping.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { StreamTransducer, type WireChunk, type WireToolCallDelta } from '../src/ai/transducer.ts'

/** Feed a whole stream and collect every chunk, as the provider shell would. */
function run(events: readonly WireChunk[], close = true) {
  const t = new StreamTransducer()
  const out = events.flatMap((e) => t.push(e))
  return close ? [...out, ...t.end()] : out
}

const text = (s: string): WireChunk => ({ choices: [{ delta: { content: s } }] })
const done = (reason = 'stop'): WireChunk => ({ choices: [{ delta: {}, finish_reason: reason }] })

describe('text streaming', () => {
  it('opens a block, streams deltas, then closes and finishes', () => {
    expect(run([text('Hel'), text('lo'), done()])).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('opens the text block only once', () => {
    const chunks = run([text('a'), text('b'), done()])
    expect(chunks.filter((c) => c.type === 'block-start')).toHaveLength(1)
  })

  it('ignores empty and null content rather than opening an empty block', () => {
    expect(
      run([{ choices: [{ delta: { content: '' } }] }, { choices: [{ delta: { content: null } }] }]),
    ).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('ignores a chunk with no choices', () => {
    expect(run([{}], false)).toEqual([])
  })

  it('ignores a choice with no delta', () => {
    expect(run([{ choices: [{}] }], false)).toEqual([])
  })
})

describe('reasoning streaming', () => {
  it('emits reasoning deltas into their own block', () => {
    expect(run([{ choices: [{ delta: { reasoning_content: 'why' } }] }, done()])).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'why' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'why' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('allocates reasoning before text when reasoning arrives first', () => {
    const chunks = run([{ choices: [{ delta: { reasoning_content: 'r' } }] }, text('t'), done()])
    expect(chunks.filter((c) => c.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'block-start', index: 1, blockType: 'text' },
    ])
  })

  it('reuses the reasoning block across deltas', () => {
    const chunks = run([
      { choices: [{ delta: { reasoning_content: 'be' } }] },
      { choices: [{ delta: { reasoning_content: 'cause' } }] },
      done(),
    ])
    expect(chunks.filter((c) => c.type === 'block-start')).toHaveLength(1)
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'reasoning', text: 'because' },
    })
  })

  it('ignores empty reasoning content', () => {
    expect(run([{ choices: [{ delta: { reasoning_content: '' } }] }], false)).toEqual([])
  })

  it('ignores null reasoning content', () => {
    expect(run([{ choices: [{ delta: { reasoning_content: null } }] }], false)).toEqual([])
  })

  // Blocks close in index order, which is not the order they are collected in:
  // reasoning is gathered first regardless of when it opened.
  it('closes blocks in index order even when text opened first', () => {
    const chunks = run([text('t'), { choices: [{ delta: { reasoning_content: 'r' } }] }, done()])
    const ends = chunks.filter((c) => c.type === 'block-end')
    expect(ends).toEqual([
      { type: 'block-end', index: 0, block: { type: 'text', text: 't' } },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'r' } },
    ])
  })

  it('closes reasoning and text in index order', () => {
    const chunks = run([{ choices: [{ delta: { reasoning_content: 'r' } }] }, text('t'), done()])
    expect(chunks.flatMap((c) => (c.type === 'block-end' ? [c.index] : []))).toEqual([0, 1])
  })
})

/** One tool-call fragment at wire index 0, carrying the fields a case supplies. */
const call = (over: Omit<Partial<WireToolCallDelta>, 'index'>): WireChunk => ({
  choices: [{ delta: { tool_calls: [{ index: 0, ...over }] } }],
})

describe('tool-call streaming', () => {
  it('keeps arguments as raw JSON string fragments and rejoins them at block-end', () => {
    expect(
      run([
        call({ id: 'c1', function: { name: 'search', arguments: '{"q":' } }),
        call({ function: { arguments: '"cats"}' } }),
        done('tool_calls'),
      ]),
    ).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'c1', name: 'search', argumentsDelta: '{"q":' },
      { type: 'tool-call-delta', index: 0, id: 'c1', name: 'search', argumentsDelta: '"cats"}' },
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'c1', name: 'search', arguments: '{"q":"cats"}' },
      },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('omits the name until the provider has sent one', () => {
    const chunks = run([call({ id: 'c1', function: { arguments: '{' } })], false)
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '{' })
  })

  it('emits an empty argumentsDelta when a fragment carries none', () => {
    const chunks = run([call({ id: 'c1' })], false)
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c1', argumentsDelta: '' })
  })

  it('gives each wire tool-call index its own block', () => {
    const chunks = run(
      [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'a', function: { name: 'f', arguments: '{}' } },
                  { index: 1, id: 'b', function: { name: 'g', arguments: '[]' } },
                ],
              },
            },
          ],
        },
        done('tool_calls'),
      ],
      true,
    )
    expect(chunks.filter((c) => c.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
    ])
  })

  it('reuses the block index across fragments of the same call', () => {
    const chunks = run(
      [call({ id: 'c1', function: { arguments: 'a' } }), call({ function: { arguments: 'b' } })],
      false,
    )
    expect(chunks.flatMap((c) => (c.type === 'tool-call-delta' ? [c.index] : []))).toEqual([0, 0])
  })

  // An empty ToolCallId could not be correlated with the result the loop sends
  // back, so a call the provider never named gets a deterministic one.
  it('gives a call the provider never named a deterministic id', () => {
    const chunks = run([call({ function: { name: 'f', arguments: '{}' } }), done('tool_calls')])
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_0', name: 'f', arguments: '{}' },
    })
  })

  it('uses the same deterministic id on the delta as on the block', () => {
    const chunks = run([call({ function: { name: 'f', arguments: '{}' } }), done('tool_calls')])
    expect(chunks.find((chunk) => chunk.type === 'tool-call-delta')).toMatchObject({ id: 'call_0' })
  })

  it('treats an empty provider id as no id', () => {
    const chunks = run([call({ id: '', function: { name: 'f', arguments: '{}' } }), done('tool_calls')])
    expect(chunks.at(-2)).toMatchObject({ block: { id: 'call_0' } })
  })

  it('exposes the reason it closed with, and none before a finish reason arrives', () => {
    const t = new StreamTransducer()
    expect(t.finishReason).toBeUndefined()
    t.push(done('length'))
    expect(t.finishReason).toEqual({ kind: 'max-tokens' })
  })

  it('keeps the first id a call was given', () => {
    const chunks = run([
      call({ id: 'first', function: { name: 'f', arguments: '{' } }),
      call({ id: 'second', function: { arguments: '}' } }),
      done('tool_calls'),
    ])
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'first', name: 'f', arguments: '{}' },
    })
  })

  it('accumulates no arguments when no fragment carries any', () => {
    const chunks = run([call({ id: 'c1', function: { name: 'f' } }), done('tool_calls')])
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'c1', name: 'f', arguments: '' },
    })
  })

  it('interleaves text and tool calls with distinct indices', () => {
    const chunks = run([
      text('thinking'),
      call({ id: 'c1', function: { name: 'f', arguments: '{}' } }),
      done('tool_calls'),
    ])
    expect(chunks.filter((c) => c.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
    ])
  })
})

describe('usage and finish ordering', () => {
  it('emits usage before finish in the same chunk', () => {
    const chunks = run([{ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1 } }])
    expect(chunks.map((c) => c.type)).toEqual(['usage', 'finish'])
  })

  it('emits usage before the closing block-end and finish', () => {
    const chunks = run([
      text('hi'),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    ])
    expect(chunks.map((c) => c.type)).toEqual(['block-start', 'text-delta', 'usage', 'block-end', 'finish'])
  })

  it('accepts usage in its own chunk before the finish chunk', () => {
    const chunks = run([{ usage: { prompt_tokens: 2 } }, done()])
    expect(chunks.map((c) => c.type)).toEqual(['usage', 'finish'])
  })

  it('ignores a null usage field', () => {
    expect(run([{ choices: [], usage: null }], false)).toEqual([])
  })

  it('emits nothing after finish, even if the provider keeps sending', () => {
    const t = new StreamTransducer()
    // The finish reason closes the blocks; the chunk itself is held back until
    // the stream ends, so a trailing usage chunk can still be observed.
    expect(t.push(done()).filter((c) => c.type === 'finish')).toEqual([])
    expect(t.push(text('late'))).toEqual([])
    expect(t.end()).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(t.push(text('later'))).toEqual([])
    // Usage is the one thing still accepted after a finish reason, so it is
    // the case that proves the door really closes once finish is emitted.
    expect(t.push({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })).toEqual([])
    expect(t.end()).toEqual([])
  })

  it('keeps the usage a provider sends after the finish reason', () => {
    // The shape `stream_options.include_usage` produces: the finish-reason
    // chunk carries `usage: null`, and the counts arrive in a final chunk with
    // no choices at all. Emitting finish on the first would drop them.
    const t = new StreamTransducer()
    const out = [
      ...t.push(text('hi')),
      ...t.push({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: null }),
      ...t.push({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      ...t.end(),
    ]
    expect(out.map((c) => c.type)).toEqual(['block-start', 'text-delta', 'block-end', 'usage', 'finish'])
    expect(out.find((c) => c.type === 'usage')).toEqual({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
  })

  it('keeps the finish reason the provider gave, not a default', () => {
    const t = new StreamTransducer()
    t.push({ choices: [{ delta: {}, finish_reason: 'length' }] })
    t.push({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 2 } })
    expect(t.end()).toEqual([{ type: 'finish', reason: { kind: 'max-tokens' } }])
  })

  it('closes a truncated stream that never sent a finish reason', () => {
    const t = new StreamTransducer()
    const out = t.push(text('partial'))
    expect(out.map((c) => c.type)).toEqual(['block-start', 'text-delta'])
    expect(t.end()).toEqual([
      { type: 'block-end', index: 0, block: { type: 'text', text: 'partial' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('finishes only once when end is called twice', () => {
    const t = new StreamTransducer()
    expect(t.end()).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(t.end()).toEqual([])
  })

  it('finishes an empty stream cleanly', () => {
    expect(new StreamTransducer().end()).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })

  it('ignores a null finish reason', () => {
    expect(
      run([{ choices: [{ delta: { content: 'x' }, finish_reason: null }] }], false).map((c) => c.type),
    ).toEqual(['block-start', 'text-delta'])
  })

  it('still emits content that arrived in the same chunk as the finish reason', () => {
    const chunks = run([
      { choices: [{ delta: {}, finish_reason: 'stop' }, { delta: { content: 'trailing' } }] },
    ])
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'trailing' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'trailing' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('emits finish only once when several choices report a reason', () => {
    const chunks = run([
      {
        choices: [
          { delta: {}, finish_reason: 'stop' },
          { delta: {}, finish_reason: 'length' },
        ],
      },
    ])
    expect(chunks.filter((c) => c.type === 'finish')).toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
  })
})

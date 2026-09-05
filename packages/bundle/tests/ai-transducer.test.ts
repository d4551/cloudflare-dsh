import { describe, expect, it } from 'vitest'
import { StreamTransducer, mapFinishReason, mapUsage, type WireChunk } from '../src/ai/transducer.ts'

/** Feed a whole stream and collect every chunk, as the adapter shell would. */
function run(events: readonly WireChunk[], close = true) {
  const t = new StreamTransducer()
  const out = events.flatMap((e) => t.push(e))
  return close ? [...out, ...t.end()] : out
}

const text = (s: string): WireChunk => ({ choices: [{ delta: { content: s } }] })
const done = (reason = 'stop'): WireChunk => ({ choices: [{ delta: {}, finish_reason: reason }] })

describe('mapFinishReason', () => {
  it('maps tool_calls', () => {
    expect(mapFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
  })

  it('maps length to max-tokens', () => {
    expect(mapFinishReason('length')).toEqual({ kind: 'max-tokens' })
  })

  it('maps stop', () => {
    expect(mapFinishReason('stop')).toEqual({ kind: 'stop' })
  })

  it('falls back to stop for an unknown reason rather than throwing', () => {
    expect(mapFinishReason('content_filter')).toEqual({ kind: 'stop' })
  })
})

describe('mapUsage', () => {
  it('reports zeros for an empty usage object', () => {
    expect(mapUsage({})).toStrictEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('maps prompt and completion tokens', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 4 })).toStrictEqual({
      inputTokens: 10,
      outputTokens: 4,
    })
  })

  it('subtracts cached tokens so the counts stay disjoint', () => {
    expect(
      mapUsage({ prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 4 } }),
    ).toStrictEqual({ inputTokens: 6, outputTokens: 1, cacheReadTokens: 4 })
  })

  it('never reports negative input when a provider over-reports cache hits', () => {
    expect(
      mapUsage({ prompt_tokens: 2, prompt_tokens_details: { cached_tokens: 9 } }).inputTokens,
    ).toBe(0)
  })

  it('omits cacheReadTokens when nothing was cached', () => {
    expect(mapUsage({ prompt_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } })).toStrictEqual({
      inputTokens: 3,
      outputTokens: 0,
    })
  })

  it('preserves a provider total when given', () => {
    expect(mapUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }).totalTokens).toBe(3)
  })

  it('omits the total when the provider did not report one', () => {
    expect(mapUsage({ prompt_tokens: 1 }).totalTokens).toBeUndefined()
  })

  it('carries reasoning tokens when reported', () => {
    expect(mapUsage({ completion_tokens_details: { reasoning_tokens: 7 } }).reasoningTokens).toBe(7)
  })

  it('omits reasoning tokens when not reported', () => {
    expect(mapUsage({}).reasoningTokens).toBeUndefined()
  })
})

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
    expect(run([{ choices: [{ delta: { content: '' } }] }, { choices: [{ delta: { content: null } }] }])).toEqual([
      { type: 'finish', reason: { kind: 'stop' } },
    ])
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
    const chunks = run(
      [
        { choices: [{ delta: { reasoning_content: 'be' } }] },
        { choices: [{ delta: { reasoning_content: 'cause' } }] },
        done(),
      ],
    )
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
    const ends = chunks.filter((c) => c.type === 'block-end')
    expect(ends.map((c) => (c as { index: number }).index)).toEqual([0, 1])
  })
})

const call = (over: Record<string, unknown>): WireChunk => ({
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
    const chunks = run([call({ id: 'c1', function: { arguments: 'a' } }), call({ function: { arguments: 'b' } })], false)
    expect(chunks.filter((c) => c.type === 'tool-call-delta').map((c) => (c as { index: number }).index)).toEqual([
      0, 0,
    ])
  })

  it('leaves the id empty when the provider never sends one', () => {
    const chunks = run([call({ function: { name: 'f', arguments: '{}' } }), done('tool_calls')])
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: '', name: 'f', arguments: '{}' },
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
    const chunks = run([text('thinking'), call({ id: 'c1', function: { name: 'f', arguments: '{}' } }), done('tool_calls')])
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
    t.push(done())
    expect(t.push(text('late'))).toEqual([])
    expect(t.end()).toEqual([])
  })

  it('reports that it has finished', () => {
    const t = new StreamTransducer()
    expect(t.isFinished).toBe(false)
    t.push(done())
    expect(t.isFinished).toBe(true)
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
    expect(run([{ choices: [{ delta: { content: 'x' }, finish_reason: null }] }], false).map((c) => c.type)).toEqual([
      'block-start',
      'text-delta',
    ])
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

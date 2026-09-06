import { describe, expect, it } from 'vitest'
import { SSE_DONE, SseDecoder, decodeLine, parseJson } from '../src/ai/sse.ts'

describe('decodeLine', () => {
  it('decodes a data line', () => {
    expect(decodeLine('data: {"a":1}')).toEqual({ kind: 'data', data: '{"a":1}' })
  })

  it('decodes a data line with no space after the colon', () => {
    expect(decodeLine('data:{"a":1}')).toEqual({ kind: 'data', data: '{"a":1}' })
  })

  it('recognises the terminal sentinel', () => {
    expect(decodeLine(`data: ${SSE_DONE}`)).toEqual({ kind: 'done' })
  })

  it('ignores a blank line', () => {
    expect(decodeLine('')).toBeUndefined()
  })

  it('ignores a comment', () => {
    expect(decodeLine(': keep-alive')).toBeUndefined()
  })

  it('ignores other SSE fields', () => {
    expect(decodeLine('event: message')).toBeUndefined()
    expect(decodeLine('id: 1')).toBeUndefined()
  })

  it('ignores a data line with an empty payload', () => {
    expect(decodeLine('data:')).toBeUndefined()
    expect(decodeLine('data:   ')).toBeUndefined()
  })
})

describe('SseDecoder', () => {
  it('emits one event per complete line', () => {
    const d = new SseDecoder()
    expect(d.push('data: a\ndata: b\n')).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ])
  })

  it('buffers a partial line until it completes', () => {
    const d = new SseDecoder()
    expect(d.push('data: par')).toEqual([])
    expect(d.push('tial\n')).toEqual([{ kind: 'data', data: 'partial' }])
  })

  it('handles CRLF line endings', () => {
    const d = new SseDecoder()
    expect(d.push('data: a\r\n')).toEqual([{ kind: 'data', data: 'a' }])
  })

  it('skips the blank lines between events', () => {
    const d = new SseDecoder()
    expect(d.push('data: a\n\ndata: b\n\n')).toEqual([
      { kind: 'data', data: 'a' },
      { kind: 'data', data: 'b' },
    ])
  })

  it('preserves a carriage return inside a line, trimming only the terminator', () => {
    const d = new SseDecoder()
    expect(d.push('data: a\rb\n')).toEqual([{ kind: 'data', data: 'a\rb' }])
  })

  it('emits the terminal sentinel', () => {
    const d = new SseDecoder()
    expect(d.push(`data: ${SSE_DONE}\n`)).toEqual([{ kind: 'done' }])
  })

  it('flushes a trailing line with no newline when the transport closes', () => {
    const d = new SseDecoder()
    d.push('data: last')
    expect(d.end()).toEqual([{ kind: 'data', data: 'last' }])
  })

  it('flushes a trailing line ending in a bare carriage return', () => {
    const d = new SseDecoder()
    d.push('data: last\r')
    expect(d.end()).toEqual([{ kind: 'data', data: 'last' }])
  })

  it('flushes nothing when the buffer is empty', () => {
    expect(new SseDecoder().end()).toEqual([])
  })

  it('flushes nothing when only a blank remainder is buffered', () => {
    const d = new SseDecoder()
    d.push('data: a\n')
    expect(d.end()).toEqual([])
  })

  it('does not re-emit a flushed remainder', () => {
    const d = new SseDecoder()
    d.push('data: last')
    d.end()
    expect(d.end()).toEqual([])
  })

  it('clears the buffer on flush, so a later push is not corrupted by it', () => {
    const d = new SseDecoder()
    d.push('data: stale')
    d.end()
    expect(d.push('data: fresh\n')).toEqual([{ kind: 'data', data: 'fresh' }])
  })

  it('preserves a carriage return inside a flushed remainder', () => {
    const d = new SseDecoder()
    d.push('data: a\rb')
    expect(d.end()).toEqual([{ kind: 'data', data: 'a\rb' }])
  })
})

describe('parseJson', () => {
  it('parses a JSON payload', () => {
    expect(parseJson('{"a":1}')).toStrictEqual({ ok: true, value: { a: 1 } })
  })

  it('reports failure for a malformed frame rather than aborting the stream', () => {
    expect(parseJson('{oops')).toStrictEqual({ ok: false })
  })

  it('parses a JSON scalar payload', () => {
    expect(parseJson('12')).toStrictEqual({ ok: true, value: 12 })
  })
})

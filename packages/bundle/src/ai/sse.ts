/**
 * Server-sent-event framing.
 *
 * Hand-rolled and pure rather than delegated to a library, for two reasons: the
 * framing rules an OpenAI-compatible stream needs are small, and keeping them
 * here means every branch is unit-testable without a socket.
 *
 * Only the `data:` field matters for these providers; comments, `event:` and
 * `id:` lines are ignored, as the SSE specification allows.
 */
import { type ParsedJson as JsonRead, parseJsonValue } from '@d4551/dsh-cloudflare-core'

/**
 * Outcome of parsing text that may not be JSON.
 *
 * An alias of the workspace's own result type rather than a second copy of the
 * union: a copy drifts, and this module's published surface only needs to name
 * what it returns.
 */
export type ParsedJson<T> = JsonRead<T>

/** Terminal payload OpenAI-compatible providers send to close a stream. */
export const SSE_DONE = '[DONE]'

/** One decoded event, or the sentinel that ends the stream. */
export type SseEvent = { readonly kind: 'data'; readonly data: string } | { readonly kind: 'done' }

/**
 * Incremental SSE decoder.
 *
 * Bytes arrive in arbitrary chunks, so the decoder buffers a partial trailing
 * line between pushes and only emits complete events.
 */
export class SseDecoder {
  private buffer = ''

  /**
   * Feed one chunk of decoded text.
   *
   * @returns the events completed by this chunk, in order.
   */
  push(text: string): SseEvent[] {
    this.buffer += text
    const events: SseEvent[] = []
    let newline = this.buffer.indexOf('\n')

    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      const event = decodeLine(line)
      if (event !== undefined) events.push(event)
      newline = this.buffer.indexOf('\n')
    }
    return events
  }

  /**
   * Flush whatever remains once the transport closes.
   *
   * A provider that ends without a trailing newline still leaves one valid
   * event in the buffer.
   */
  end(): SseEvent[] {
    const remainder = this.buffer.replace(/\r$/, '')
    this.buffer = ''
    const event = decodeLine(remainder)
    return event === undefined ? [] : [event]
  }
}

/**
 * Decode one line.
 *
 * @returns the event, or undefined for blank lines, comments and other fields.
 */
export function decodeLine(line: string): SseEvent | undefined {
  if (!line.startsWith('data:')) return undefined
  const data = line.slice('data:'.length).trimStart()
  if (data === '') return undefined
  if (data === SSE_DONE) return { kind: 'done' }
  return { kind: 'data', data }
}

/**
 * Parse text as JSON without throwing.
 *
 * The implementation is the workspace's one total JSON reader:
 * `parseJsonValue` proves the text is a single well-formed document before the
 * platform parser runs, so the parse cannot throw and nothing needs a `catch`,
 * and the value is built from the grammar rather than asserted into a type
 * argument the caller supplied. The name is bound rather than the body
 * rewritten, so the stream reader, the log reader and the package's published
 * surface all reach that one reader without a second implementation sitting
 * behind them.
 */
export const parseJson = parseJsonValue

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

/** Outcome of parsing one event payload. */
export type ParsedEvent<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

/**
 * Parse an event's data payload as JSON.
 *
 * Returns a tagged result rather than `undefined`, so "this frame was not
 * JSON" is a state the caller has to handle explicitly — a malformed frame is
 * skipped rather than aborting an otherwise good stream.
 */
export function parseEventData<T>(data: string): ParsedEvent<T> {
  try {
    return { ok: true, value: JSON.parse(data) as T }
  } catch {
    return { ok: false }
  }
}

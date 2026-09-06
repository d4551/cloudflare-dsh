/**
 * Pure rendering helpers shared by every tool.
 *
 * `output.render` runs on session-log replay as well as live, so everything
 * here must be a pure function of its arguments: no I/O, no clock, no random.
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

/** Wrap plain text as a single content block. */
export function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Render a value as pretty JSON in a single block. */
export function json(value: unknown): ContentBlock[] {
  return text(JSON.stringify(value, null, 2))
}

/** English pluralisation for count summaries. */
export function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`
}

/**
 * Summarise a listing: a count line, then the payload as JSON.
 *
 * Keeping the count in the text means the model can act on "how many" without
 * parsing the JSON, while the JSON stays available for programmatic use.
 */
export function listing(count: number, noun: string, value: unknown, note?: string): ContentBlock[] {
  const context = note === undefined ? '' : ` (${note})`
  return text(`${plural(count, noun)}${context}\n${JSON.stringify(value, null, 2)}`)
}

/**
 * The output property every listing uses for the records it hands back.
 *
 * Seven tools spelled this block out, differing only in the noun. The return
 * type is declared rather than inferred, so the literal types survive without
 * a const assertion — which sources here may not carry, since one would hide
 * a whole file from mutation testing.
 */
export interface ApiRecordsProperty {
  readonly type: 'array'
  readonly required: true
  readonly description: string
  readonly items: { readonly type: 'object'; readonly additionalProperties: true }
}

/** Declare an array of opaque API records, named by what they are. */
export function apiRecords(noun: string): ApiRecordsProperty {
  return {
    type: 'array',
    required: true,
    description: `${noun} records as the API returns them.`,
    items: { type: 'object', additionalProperties: true },
  }
}

/**
 * Truncate long text for display, marking that it was cut.
 *
 * Tool output can be large (a rendered page, a query result); the canonical
 * value keeps everything, this only bounds what the model reads.
 */
export function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n… truncated ${plural(value.length - limit, 'character')}`
}

/**
 * A value as pretty JSON, bounded to `limit` characters.
 *
 * `json()` is unbounded, so a wide query result reached the model whole even
 * though a render budget was configured for it. The canonical value still
 * carries everything — this bounds only what is read. Returned as a string so
 * a presenter can put it under a heading in one block rather than two.
 */
export function boundedJson(value: unknown, limit: number): string {
  return truncate(JSON.stringify(value, null, 2), limit)
}

/** Render a value as bounded pretty JSON in a single block. */
export function truncatedJson(value: unknown, limit: number): ContentBlock[] {
  return text(boundedJson(value, limit))
}

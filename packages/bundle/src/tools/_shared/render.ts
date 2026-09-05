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
export function listing(count: number, noun: string, value: unknown): ContentBlock[] {
  return text(`${plural(count, noun)}\n${JSON.stringify(value, null, 2)}`)
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

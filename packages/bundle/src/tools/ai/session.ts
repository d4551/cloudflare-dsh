/**
 * Reading one harness session out of AI Gateway logs.
 *
 * Pure on purpose: the arithmetic is unit-testable without a gateway, and the
 * session-cost tool re-checks every row the server filter returns, because
 * Cloudflare's schema does not document how positional filter repeats are
 * paired — a filter the server ignored would bill one session another's cost.
 */
import { SESSION_METADATA_KEY } from '../../ai/headers.ts'
import { parseJson } from '../../ai/sse.ts'
import { isFiniteNumber, isObject, type JsonValue } from '../_shared/json.ts'

/** Raised when a log entry carries a field the summary cannot add up. */
export class GatewayLogShapeError extends TypeError {
  override readonly name = 'GatewayLogShapeError'
  constructor(field: string, value: JsonValue) {
    super(
      `gateway log field ${field} must be a number, got ${typeof value} (${JSON.stringify(value)}). ` +
        'Summing it would produce a total that is silently wrong.',
    )
  }
}

/** Read one numeric field, refusing a value that would corrupt the total. */
function numericField(log: Record<string, JsonValue>, field: 'cost' | 'tokens_in' | 'tokens_out'): number {
  const value = log[field]
  if (value === undefined) return 0
  // `cost += "0.004"` concatenates and turns the running total into a string.
  // A decimal returned as a string is a plausible API shape, so it is rejected
  // rather than added. `Number.isFinite` does not coerce, so it rejects every
  // non-number as well as NaN and the infinities — no separate `typeof` arm.
  if (!isFiniteNumber(value)) throw new GatewayLogShapeError(field, value)
  return value
}

/**
 * The session id a log entry actually carries.
 *
 * The API returns `metadata` as a JSON string, so this parses it rather than
 * trusting the server-side filter to have been applied.
 */
export function sessionOf(entry: Record<string, JsonValue>): string | undefined {
  // No separate string guard: `JSON.parse` coerces its argument, and every
  // non-string value either fails to parse or fails the object check below, so
  // a guard would be a branch nothing could observe.
  const parsed = parseJson<JsonValue>(String(entry.metadata))
  // Anything but an object — `null`, a number, a string — carries no session
  // id; the predicate also types the read.
  if (!parsed.ok || !isObject(parsed.value)) return undefined
  const value = parsed.value[SESSION_METADATA_KEY]
  return typeof value === 'string' ? value : undefined
}

/**
 * Reduce gateway log entries to a session summary.
 *
 * Pure, so the arithmetic is unit-testable without a gateway; missing fields
 * count as zero because Cloudflare omits them for some providers.
 */
export function summariseSessionLogs(logs: readonly Record<string, JsonValue>[]): {
  requests: number
  cost: number
  tokensIn: number
  tokensOut: number
  cached: number
} {
  let cost = 0
  let tokensIn = 0
  let tokensOut = 0
  let cached = 0
  for (const log of logs) {
    cost += numericField(log, 'cost')
    tokensIn += numericField(log, 'tokens_in')
    tokensOut += numericField(log, 'tokens_out')
    if (log.cached === true) cached += 1
  }
  return { requests: logs.length, cost, tokensIn, tokensOut, cached }
}

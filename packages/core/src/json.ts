/**
 * Reading a JSON document without an exception.
 *
 * `JSON.parse` throws, and a thrown value carries no type: a caller that needs
 * to know whether a body was JSON has to catch, and what a catch hands back is
 * `unknown`, which can only become usable through a cast that asserts the very
 * shape nobody checked. This workspace bans both, so the answer is to make the
 * parse total instead: `isJsonDocument` proves the text is exactly one
 * well-formed JSON document, and `parseJsonValue` runs the platform parser only
 * once that proof holds — after which it cannot throw, and no branch of it
 * needs a catch.
 *
 * The validator is the load-bearing half. It implements the RFC 8259 grammar
 * directly: whitespace, `true`/`false`/`null`, the number grammar, string
 * literals with the eight single-character escapes and `\uXXXX`, arrays and
 * objects, and a rejection of anything trailing the top-level value. It
 * *recognises* rather than *builds*, so it decodes nothing and constructs
 * nothing: the value still comes from the platform parser, which is the one
 * implementation of JSON in this workspace.
 *
 * Nesting is bounded explicitly rather than left to the stack. The input is an
 * untrusted response body, so the ceiling is a declared constant instead of
 * whatever depth the engine happens to survive; legitimate Cloudflare payloads
 * nest a handful of levels.
 */
import type { JsonValue } from './types.ts'

/** Outcome of reading text that may not be a JSON document. */
export type ParsedJson<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

/**
 * Nesting ceiling for the validator.
 *
 * A recursive grammar is bounded by the call stack, and the depth here is
 * attacker-controlled, so it is stated rather than inherited.
 */
const MAX_DEPTH = 512

/** The four characters the grammar admits between tokens. */
function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r'
}

/** Exactly four hex digits, the only body a `\u` escape can have. */
const HEX = /^[0-9a-fA-F]{4}$/

/** The eight escapes that stand for one character each. */
const ESCAPED = new Set<string>(['"', '\\', '/', 'b', 'f', 'n', 'r', 't'])

/** The number grammar, anchored at the cursor by slicing from it. */
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/

/** The cursor a recogniser leaves behind, or nothing when it refused the input. */
type Cursor = number | undefined

/** The offset of the first non-whitespace character at or after `from`. */
function skipWhitespace(text: string, from: number): number {
  let at = from
  while (at < text.length && isWhitespace(text.charAt(at))) at += 1
  return at
}

/**
 * Recognise one string literal, opening at `start`.
 *
 * A raw character below U+0020 is refused: the grammar has no spelling for one,
 * so a body carrying it is not the document it claims to be. Every `\u` escape
 * is checked for four hex digits here and left for the parser to decode, which
 * is what keeps this half free of any decoding of its own.
 */
function recogniseString(text: string, start: number): Cursor {
  let at = start + 1
  while (at < text.length) {
    const character = text.charAt(at)
    if (character === '"') return at + 1
    if (text.charCodeAt(at) <= 0x1f) return undefined
    if (character !== '\\') {
      at += 1
      continue
    }
    const escape = text.charAt(at + 1)
    if (ESCAPED.has(escape)) {
      at += 2
      continue
    }
    if (escape !== 'u' || !HEX.test(text.slice(at + 2, at + 6))) return undefined
    at += 6
  }
  return undefined
}

/** Recognise one number literal, opening at `start`. */
function recogniseNumber(text: string, start: number): Cursor {
  const [literal] = NUMBER.exec(text.slice(start)) ?? []
  return literal === undefined ? undefined : start + literal.length
}

/** Recognise one array, opening at `start`. */
function recogniseArray(text: string, start: number, depth: number): Cursor {
  let at = skipWhitespace(text, start + 1)
  if (text.charAt(at) === ']') return at + 1
  for (;;) {
    const item = recogniseValue(text, at, depth + 1)
    if (item === undefined) return undefined
    at = skipWhitespace(text, item)
    if (text.charAt(at) === ',') {
      at = skipWhitespace(text, at + 1)
      continue
    }
    // A trailing comma leaves the cursor on `]`, which is refused here rather
    // than accepted as an empty final member.
    return text.charAt(at) === ']' ? at + 1 : undefined
  }
}

/** Recognise one object, opening at `start`. */
function recogniseObject(text: string, start: number, depth: number): Cursor {
  let at = skipWhitespace(text, start + 1)
  if (text.charAt(at) === '}') return at + 1
  for (;;) {
    if (text.charAt(at) !== '"') return undefined
    const key = recogniseString(text, at)
    if (key === undefined) return undefined
    at = skipWhitespace(text, key)
    if (text.charAt(at) !== ':') return undefined
    at = skipWhitespace(text, at + 1)
    const member = recogniseValue(text, at, depth + 1)
    if (member === undefined) return undefined
    at = skipWhitespace(text, member)
    if (text.charAt(at) === ',') {
      at = skipWhitespace(text, at + 1)
      continue
    }
    return text.charAt(at) === '}' ? at + 1 : undefined
  }
}

/** Recognise one value, opening at `start`. */
function recogniseValue(text: string, start: number, depth: number): Cursor {
  if (depth > MAX_DEPTH) return undefined
  const character = text.charAt(start)
  if (character === '"') return recogniseString(text, start)
  if (character === '[') return recogniseArray(text, start, depth)
  if (character === '{') return recogniseObject(text, start, depth)
  if (character === 't') return text.startsWith('true', start) ? start + 4 : undefined
  if (character === 'f') return text.startsWith('false', start) ? start + 5 : undefined
  if (character === 'n') return text.startsWith('null', start) ? start + 4 : undefined
  return recogniseNumber(text, start)
}

/**
 * Whether the text is exactly one well-formed JSON document.
 *
 * Trailing non-whitespace is a refusal: two concatenated documents, or a
 * document followed by an error page, is not the document the caller asked for
 * and must not be read as one.
 */
export function isJsonDocument(text: string): boolean {
  const end = recogniseValue(text, skipWhitespace(text, 0), 0)
  return end !== undefined && skipWhitespace(text, end) === text.length
}

/**
 * Read a JSON document, or report that it was not one.
 *
 * The platform parser runs only behind the proof above, so it cannot throw and
 * nothing here needs a catch. Its result is the platform's own JSON value —
 * there is one JSON implementation in this workspace, and this is it.
 */
export function parseJsonValue(text: string): ParsedJson<JsonValue> {
  if (!isJsonDocument(text)) return { ok: false }
  const value: JsonValue = JSON.parse(text)
  return { ok: true, value }
}

/** Whether a value is a JSON object rather than an array or a scalar. */
export function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

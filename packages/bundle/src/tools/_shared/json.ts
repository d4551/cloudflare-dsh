/**
 * Runtime guards over parsed JSON values.
 *
 * The canonical JSON value type is `JsonValue` in
 * `@d4551/dsh-cloudflare-core/types` — the wire layer that serializes every
 * body. These predicates check the shape of one value before a part of it is
 * read; `undefined` is admitted because an absent field reaches them as
 * often as a present one.
 */
import type { JsonValue } from '@d4551/dsh-cloudflare-core/types'

/**
 * Whether a value is an object. `null` is not, nor is any primitive; an array
 * is, and indexing one by a property name yields `undefined` like any object
 * without that key.
 */
export function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a value is a finite number. `Number.isFinite` does not coerce, so
 * every non-number fails along with NaN and the infinities.
 */
export function isFiniteNumber(value: JsonValue | undefined): value is number {
  return Number.isFinite(value)
}

/**
 * Whether a value is an integer. `Number.isInteger` does not coerce, so every
 * non-number fails along with fractions, NaN and the infinities.
 */
export function isInteger(value: JsonValue | undefined): value is number {
  return Number.isInteger(value)
}

/** Whether a value is an array whose every item is a string; an empty array is one. */
export function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

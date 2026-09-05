/**
 * Lossless JSON value type.
 *
 * Declared locally rather than imported from a harness internal package, so
 * the bundle's type surface does not depend on a package it never calls.
 * Tool `execute` bodies must return a value of this shape: the registry
 * snapshots it as JSON, validates it against `output.schema`, and freezes it.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Whether a parsed value is an object. `null` is not, nor is any primitive;
 * an array is, and indexing one by a property name yields `undefined` like
 * any object without that key.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Whether a value is a finite number. `Number.isFinite` does not coerce, so
 * every non-number fails along with NaN and the infinities.
 */
export function isFiniteNumber(value: unknown): value is number {
  return Number.isFinite(value)
}

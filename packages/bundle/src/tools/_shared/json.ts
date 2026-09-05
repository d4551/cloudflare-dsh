/**
 * Lossless JSON value type.
 *
 * Declared locally rather than imported from a harness internal package, so
 * the bundle's type surface does not depend on a package it never calls.
 * Tool `execute` bodies must return a value of this shape: the registry
 * snapshots it as JSON, validates it against `output.schema`, and freezes it.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

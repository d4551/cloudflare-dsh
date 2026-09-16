/**
 * The shape a value has when it arrives from the host.
 *
 * A tool call's block, and the projection a tool publishes inside it, reach this
 * package as data: the harness persists the projection with the session log and
 * replays it, and a running call's block is serialized the same way. So every
 * field this package reads has been through JSON, which is the claim this type
 * makes — a smaller claim than a value of no known shape, and one a reader can
 * act on: a wire value can be indexed, compared and narrowed field by field
 * without a single assertion, and a primitive cannot be mistaken for a record.
 *
 * `undefined` is a member because a record on the wire can hold a field that is
 * absent. A projection with a missing figure is what a malformed one looks like,
 * and the guards in the views have to be able to say so rather than treat the
 * absence as a value.
 *
 * Nothing here is asserted. The host's published declarations cannot be
 * imported — they reference type-only packages they do not depend on, and one
 * of them does not typecheck against its own slot map with `skipLibCheck` off —
 * so the fields this package reads are read and checked one at a time.
 */

/** A value as the wire carries it: JSON, plus the absence a missing field has. */
export type WireValue = undefined | string | number | boolean | null | readonly WireValue[] | WireObject

/** A wire value with named fields: a record, as opposed to a list. */
export type WireObject = { readonly [key: string]: WireValue }

/**
 * Whether a value is a record rather than a list or a primitive.
 *
 * `Array.isArray` is what separates the object arm of the union from the list
 * arm: both answer `object` to `typeof`, so a check that stops at `typeof` reads
 * a list as a record and a missing field as an absent one.
 */
export function isWireObject(value: WireValue): value is WireObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a list, so its entries can be read one at a time. */
export function isWireArray(value: WireValue): value is readonly WireValue[] {
  return Array.isArray(value)
}

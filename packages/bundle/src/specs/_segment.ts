/**
 * Path-segment encoding, shared by the spec builders.
 *
 * Two spec modules declared this identically. One of them documented it and
 * the other did not, which is how a duplicate starts drifting.
 */

/** Percent-encode one path segment, so an id carrying a slash cannot escape it. */
export function seg(value: string): string {
  return encodeURIComponent(value)
}

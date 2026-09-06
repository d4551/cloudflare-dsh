/**
 * The refusal shared by every bulk tool.
 *
 * A request naming nothing would be issued, answered, and reported as a
 * success that changed nothing — which reads to the model as work done.
 */

/** Raised when a bulk operation names nothing: the request would do nothing and report success. */
export class EmptyBatchError extends RangeError {
  override readonly name = 'EmptyBatchError'
  constructor(field: string) {
    super(`${field} must name at least one item; an empty request would do nothing`)
  }
}

import { ConflictError } from '~/shared/errors'

/**
 * The key was reused for a report that says something else. Answering with the
 * stored result would confirm a write that never happened, so the caller is told
 * its key is already spoken for.
 */
export class CheckStatusIdempotencyConflictError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'check status idempotency key',
			context,
			'This idempotency key already recorded a different status.'
		)
	}
}

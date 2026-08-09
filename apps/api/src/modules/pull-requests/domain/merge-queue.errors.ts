import { ConflictError, ForbiddenError, NotFoundError } from '~/shared/errors'

export class MergeQueueEntryAlreadyExistsError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'merge queue entry',
			context,
			'This pull request is already in the merge queue.'
		)
	}
}

/**
 * The repository's merge lease is held by somebody else, or was lost while this
 * caller was working. The hold is repository-wide — another pull request's merge
 * may own it — so the refusal names the repository rather than claiming this
 * pull request is the one merging.
 */
export class RepositoryMergeInProgressError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository merge',
			context,
			'Merge work is in progress on this repository. Try again once it settles.'
		)
	}
}

export class MergeQueueEntryNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('merge queue entry', context)
	}
}

/**
 * An entry in `merging` has already handed the branch to Git, and taking it out
 * from under that would leave a pull request that merged beside a queue that
 * says it was withdrawn. The merge is short: it either lands or hands the entry
 * back, and leaving is possible again either way.
 */
export class MergeQueueEntryMergingError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'merge queue entry',
			context,
			'This pull request is being merged right now and cannot leave the queue.'
		)
	}
}

export class MergeQueueEntryNotPausedError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'merge queue entry',
			context,
			'Only a paused merge queue entry can be retried.'
		)
	}
}

/**
 * Leaving the queue is a decision about somebody else's merge, so it belongs to
 * whoever put the pull request there or to an administrator of the repository.
 */
export class MergeQueueEntryForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'merge queue entry',
			context,
			'Only the user who queued this pull request or a repository administrator can remove it.'
		)
	}
}

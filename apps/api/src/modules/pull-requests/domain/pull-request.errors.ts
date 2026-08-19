import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import type {
	MergeQueueState,
	MergeStrategy,
	MergeStrategyUnavailableReason,
} from '@repo/domain'
import { BadRequestError, ConflictError, NotFoundError } from '~/shared/errors'

export class PullRequestNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request', context)
	}
}

/** The side of a file the caller asked to expand holds no readable text at those commits. */
export class PullRequestFileContentNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request file content', context)
	}
}

export class PullRequestInvalidBranchesError extends BadRequestError {
	constructor(context?: Record<string, unknown>, message?: string) {
		super('pull request branches', context, message)
	}
}

export class PullRequestPushNotificationInvalidError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request push notification',
			context,
			'The push notification is malformed.'
		)
	}
}

export class PullRequestNoChangesError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request',
			context,
			'The source branch has no changes relative to the target branch.'
		)
	}
}

export class PullRequestAlreadyOpenError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request',
			context,
			'An open pull request already exists for these branches.'
		)
	}
}

export class PullRequestStateConflictError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request state',
			context,
			'The pull request is not in a valid state for this action.'
		)
	}
}

/**
 * This pull request's own merge is under way against the target being moved.
 * The merge was cleared against the branches as they stand and Git may be acting
 * on them right now, so the move waits rather than racing it.
 */
export class PullRequestMergeInProgressError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request merge',
			context,
			'A merge is in progress for this pull request. Try again once it settles.'
		)
	}
}

/**
 * A queue entry is a statement about the branches it was queued for, so the
 * target only moves once the pull request has left the queue. Removing the entry
 * here would decide for the person who queued it.
 *
 * What they can do about it depends on the state: an entry that has reached
 * `merging` cannot be taken back out — Git already has the branch — so telling
 * its author to leave the queue would send them at a refusal.
 */
export class PullRequestQueuedError extends ConflictError {
	constructor(queueState: MergeQueueState, context?: Record<string, unknown>) {
		super(
			'pull request merge queue',
			{ ...context, queueState },
			queueState === 'merging'
				? 'This pull request is being merged right now. Change the target once that merge has settled.'
				: 'Leave the merge queue before changing the target branch.'
		)
	}
}

export class PullRequestStaleComparisonError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request comparison',
			context,
			PULL_REQUEST_STALE_COMPARISON_MESSAGE
		)
	}
}

export class PullRequestMergeConflictError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request merge',
			context,
			'The pull request cannot be merged cleanly.'
		)
	}
}

/**
 * Git refused the strategy itself rather than the content: the branches cannot
 * fast-forward, or the replay had nothing to put on the target. The reason
 * travels on the error so the refusal reaches the caller as the same blocking
 * reason the requirements would have reported a moment earlier.
 */
export class PullRequestMergeStrategyUnavailableError extends ConflictError {
	constructor(
		readonly strategy: MergeStrategy,
		readonly unavailableReason: MergeStrategyUnavailableReason,
		context?: Record<string, unknown>
	) {
		super(
			'pull request merge strategy',
			{ ...context, strategy, unavailableReason },
			'The pull request cannot be merged with the selected method.'
		)
	}
}

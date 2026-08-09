import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import type {
	MergeStrategy,
	MergeStrategyUnavailableReason,
} from '@repo/domain'
import { BadRequestError, ConflictError, NotFoundError } from '~/shared/errors'

export class PullRequestNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request', context)
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

import { ConflictError, ForbiddenError, NotFoundError } from '~/shared/errors'

export class PullRequestReviewerIneligibleError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request reviewer',
			context,
			'The requested reviewer cannot review this pull request.'
		)
	}
}

export class PullRequestReviewerRequestForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('pull request reviewer request', context)
	}
}

export class PullRequestReviewerRequestNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request reviewer request', context)
	}
}

export class PullRequestReviewerAlreadyRequestedError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request reviewer request',
			context,
			'This reviewer has already been requested.'
		)
	}
}

export class PullRequestReviewAuthorForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request review',
			context,
			'The pull request author cannot review their own pull request.'
		)
	}
}

export class PullRequestPendingReviewNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request pending review', context)
	}
}

export class PullRequestPendingReviewConflictError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request pending review',
			context,
			'Your pending review was submitted or discarded elsewhere. Refresh the pull request and try again.'
		)
	}
}

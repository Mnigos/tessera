import { ConflictError, ForbiddenError, NotFoundError } from '~/shared/errors'

export class PullRequestThreadNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request thread', context)
	}
}

export class PullRequestCommentNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('pull request comment', context)
	}
}

export class PullRequestCommentForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('pull request comment', context)
	}
}

export class PullRequestThreadResolutionForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('pull request thread resolution', context)
	}
}

export class PullRequestThreadUnpublishedError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'pull request thread resolution',
			context,
			'This thread holds only pending review comments. Submit your review before resolving it.'
		)
	}
}

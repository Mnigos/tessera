import { ForbiddenError, NotFoundError } from '~/shared/errors'

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

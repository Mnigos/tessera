import {
	ForbiddenError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'

export class GitAccessTokenNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('git access token', context)
	}
}

export class InvalidGitAccessTokenError extends UnauthorizedError {
	constructor(context?: Record<string, unknown>) {
		super('git access token', context)
	}
}

export class GitAccessTokenPermissionDeniedError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('git access token permission', context)
	}
}

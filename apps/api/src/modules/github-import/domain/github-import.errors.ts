import {
	ExternalServiceError,
	ForbiddenError,
	UnauthorizedError,
} from '~/shared/errors'

export class GitHubImportAuthenticationError extends UnauthorizedError {
	constructor(context?: Record<string, unknown>) {
		super('github import', context)
	}
}

export class GitHubImportForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('github import', context)
	}
}

export class GitHubImportExternalServiceError extends ExternalServiceError {
	constructor(
		context?: Record<string, unknown>,
		options?: { cause?: unknown }
	) {
		super('github', context, 'GitHub import request failed', options)
	}
}

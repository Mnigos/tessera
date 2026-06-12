import {
	ConflictError,
	ExternalServiceError,
	ForbiddenError,
	NotFoundError,
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

export class GitHubImportDuplicateActiveSourceError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super('github repository import source', context)
	}
}

export class GitHubImportTargetSlugUnavailableError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super('github repository import target slug', context)
	}
}

export class GitHubImportNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('github repository import', context)
	}
}

export class GitHubImportNotRetryableError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'github repository import',
			context,
			'github repository import is not retryable'
		)
	}
}

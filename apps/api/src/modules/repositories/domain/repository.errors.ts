import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'

export class InvalidRepositoryNameError extends BadRequestError {
	constructor(name: string) {
		super('repository name', { name })
	}
}

export class InvalidRepositorySlugError extends BadRequestError {
	constructor(slug: string) {
		super('repository slug', { slug })
	}
}

export class DuplicateRepositorySlugError extends ConflictError {
	constructor(slug: string) {
		super('repository slug', { slug })
	}
}

export class RepositoryCreatorUsernameRequiredError extends BadRequestError {
	constructor() {
		super(
			'repository creator username',
			{
				field: 'username',
				location: 'session',
				reason: 'missing_session_username',
			},
			'Repository creator username is required'
		)
	}
}

export class RepositoryOwnerUsernameRequiredError extends BadRequestError {
	constructor() {
		super(
			'repository owner username',
			{
				field: 'username',
				location: 'path',
				reason: 'missing_path_param',
			},
			'Repository owner username is required'
		)
	}
}

export class RepositoryNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('repository', context)
	}
}

export class RepositoryCreateFailedError extends InternalError {
	constructor() {
		super('repository create')
	}
}

export class InternalGitRepositoryAuthorizationError extends UnauthorizedError {
	constructor() {
		super('internal git repository read')
	}
}

export class PrivateRepositoryGitReadForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('repository git read', context)
	}
}

export class RepositoryStoragePathMissingError extends InternalError {
	constructor(context?: Record<string, unknown>) {
		super('repository storage path', context)
	}
}

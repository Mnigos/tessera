import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
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

export class RepositoryBrowserInvalidRequestError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('repository browser request', context)
	}
}

export class RepositoryCreateFailedError extends InternalError {
	constructor() {
		super('repository create')
	}
}

export class PrivateRepositoryGitReadForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('repository git read', context)
	}
}

export class RepositoryGitWriteForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('repository git write', context)
	}
}

export class RepositoryGitHubSourceOfTruthWriteForbiddenError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository git write',
			context,
			'GitHub is the source of truth for this repository. Push to GitHub instead.'
		)
	}
}

export class RepositoryStoragePathMissingError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository',
			{ ...context, reason: 'storage_path_missing' },
			'repository not found while storage is being prepared'
		)
	}
}

export class RepositoryGitHubMirrorSyncUnavailableError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('repository github mirror sync', context)
	}
}

export class RepositoryGitHubMirrorCutoverUnavailableError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('repository github mirror cutover', context)
	}
}

export class RepositoryGitHubMirrorCutoverSyncInProgressError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository github mirror cutover',
			context,
			'GitHub mirror cutover is unavailable while sync is in progress.'
		)
	}
}

export class RepositoryGitHubPushBackUnavailableError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('repository github push-back mirror', context)
	}
}

export class RepositoryGitHubPushBackDisabledError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository github push-back mirror',
			context,
			'GitHub push-back mirror is disabled for this repository.'
		)
	}
}

export class RepositoryGitHubPushBackInProgressError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository github push-back mirror',
			context,
			'GitHub push-back mirror is already running for this repository.'
		)
	}
}

export class RepositoryGitHubPushBackTokenMissingError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository github push-back mirror',
			context,
			'GitHub access token is required to push this mirror.'
		)
	}
}

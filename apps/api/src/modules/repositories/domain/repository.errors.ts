import { BadRequestError, ConflictError, NotFoundError } from '~/shared/errors'

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

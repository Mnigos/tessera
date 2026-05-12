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

export class RepositoryNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('repository', context)
	}
}

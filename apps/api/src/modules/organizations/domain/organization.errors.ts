import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	ServiceUnavailableError,
} from '~/shared/errors'

export class OrganizationNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('organization', context)
	}
}

/**
 * Users and organizations share the /{handle} namespace, so the message names
 * both rather than telling someone their handle is free when it is not.
 */
export class OrganizationSlugTakenError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization handle',
			context,
			'This handle is already taken by a user or organization.'
		)
	}
}

/**
 * The handle belongs to a GitHub account nobody here can prove they own.
 * Linking that GitHub account is the way out, so the message says so.
 */
export class OrganizationSlugGitHubConflictError extends ConflictError {
	constructor(login: string, context?: Record<string, unknown>) {
		super(
			'organization handle',
			{ ...context, login },
			`${login} is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.`
		)
	}
}

/**
 * GitHub could not answer, so the handle is neither free nor taken. Failing
 * closed keeps an outage from handing out a login somebody else owns.
 */
export class GitHubLookupUnavailableError extends ServiceUnavailableError {
	constructor(
		context?: Record<string, unknown>,
		options?: { cause?: unknown }
	) {
		super(
			'github',
			context,
			"GitHub availability for this handle couldn't be verified. Try again in a moment.",
			options
		)
	}
}

export class OrganizationHasRepositoriesError extends ConflictError {
	constructor(repositoryCount: number, context?: Record<string, unknown>) {
		super(
			'organization',
			{ ...context, repositoryCount },
			"Transfer or delete the organization's repositories before deleting it."
		)
	}
}

export class OrganizationPermissionDeniedError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('organization', context)
	}
}

export class OrganizationDeleteConfirmationError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization delete confirmation',
			context,
			'Type the organization handle to confirm.'
		)
	}
}

export class OrganizationCreateFailedError extends InternalError {
	constructor(context?: Record<string, unknown>) {
		super('organization create', context)
	}
}

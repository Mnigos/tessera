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

export class OrganizationSlugTakenError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization handle',
			context,
			'This handle is already taken by a user or organization.'
		)
	}
}

export class OrganizationSlugGitHubConflictError extends ConflictError {
	constructor(login: string, context?: Record<string, unknown>) {
		super(
			'organization handle',
			{ ...context, login },
			`${login} is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.`
		)
	}
}

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

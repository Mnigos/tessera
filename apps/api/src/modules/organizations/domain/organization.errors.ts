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

export class OrganizationMemberNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('organization member', context)
	}
}

export class OrganizationLastOwnerError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization owner',
			context,
			'An organization needs at least one owner.'
		)
	}
}

export class OrganizationMemberAlreadyExistsError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization member',
			context,
			'This person is already a member of the organization.'
		)
	}
}

export class OrganizationInvitationNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('organization invitation', context)
	}
}

export class OrganizationInvitationExpiredError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization invitation',
			context,
			'This invitation has expired. Ask an organization admin to send a new one.'
		)
	}
}

export class OrganizationInvitationEmailMismatchError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization invitation',
			context,
			'This invitation was sent to a different email address.'
		)
	}
}

export class OrganizationInvitationPendingError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization invitation',
			context,
			'An invitation for this email is already pending.'
		)
	}
}

export class OrganizationLimitReachedError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization',
			context,
			'This organization has reached its limit. Remove a member or cancel a pending invitation first.'
		)
	}
}

export class OrganizationBusyError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'organization',
			context,
			'Another change to this organization is in progress. Try again.'
		)
	}
}

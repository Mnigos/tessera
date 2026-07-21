import {
	BadRequestError,
	ConflictError,
	InternalError,
	NotFoundError,
} from '~/shared/errors'

export class RepositoryCollaboratorNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('repository collaborator', context)
	}
}

export class RepositoryCollaboratorAlreadyExistsError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository collaborator',
			context,
			'This user is already a collaborator on the repository.'
		)
	}
}

export class RepositoryCollaboratorOwnerError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository collaborator',
			context,
			'The repository owner cannot be added as a collaborator.'
		)
	}
}

export class RepositoryCollaboratorImplicitAccessError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super(
			'repository collaborator',
			context,
			'This user already has implicit organization access to the repository.'
		)
	}
}

export class RepositoryCollaboratorCreateFailedError extends InternalError {
	constructor(context?: Record<string, unknown>) {
		super('repository collaborator create', context)
	}
}

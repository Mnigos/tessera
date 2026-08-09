import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'

export class InvalidCheckStatusCredentialError extends UnauthorizedError {
	constructor(context?: Record<string, unknown>) {
		super('check status credential', context)
	}
}

/**
 * The credential authenticated but does not speak for this repository — or the
 * path names no repository at all. One refusal covers both, so holding a valid
 * credential never becomes a way to find out which repositories exist.
 */
export class CheckStatusRepositoryMismatchError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super(
			'check status repository',
			context,
			'This credential cannot publish statuses to this repository.'
		)
	}
}

/**
 * The key authenticated but does not carry `checks:write`. Separate from an
 * invalid credential because the caller is real and the answer is about what it
 * may do, not about who it is.
 */
export class CheckStatusPermissionDeniedError extends ForbiddenError {
	constructor(context?: Record<string, unknown>) {
		super('check status credential permission', context)
	}
}

export class CheckStatusProviderNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('check status provider', context)
	}
}

export class CheckStatusCredentialNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('check status credential', context)
	}
}

export class CheckStatusProviderAlreadyExistsError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super(
			'check status provider',
			context,
			'This repository already has a status provider with that key.'
		)
	}
}

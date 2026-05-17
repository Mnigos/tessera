import { BadRequestError, ConflictError, NotFoundError } from '~/shared/errors'

export class InvalidSshPublicKeyError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('ssh public key', context)
	}
}

export class DuplicateSshPublicKeyError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super('ssh public key', context)
	}
}

export class SshPublicKeyNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('ssh public key', context)
	}
}

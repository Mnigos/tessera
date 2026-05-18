import { BadRequestError, ConflictError, NotFoundError } from '~/shared/errors'

export class InvalidGpgPublicKeyError extends BadRequestError {
	constructor(context?: Record<string, unknown>) {
		super('gpg public key', context)
	}
}

export class DuplicateGpgPublicKeyError extends ConflictError {
	constructor(context?: Record<string, unknown>) {
		super('gpg public key', context)
	}
}

export class GpgPublicKeyNotFoundError extends NotFoundError {
	constructor(context?: Record<string, unknown>) {
		super('gpg public key', context)
	}
}

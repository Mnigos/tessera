export class ApiError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = new.target.name
	}
}

export class NotFoundError extends ApiError {}

export class ConflictError extends ApiError {}

export class ForbiddenError extends ApiError {}

export class ServiceUnavailableError extends ApiError {}

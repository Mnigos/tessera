import { DomainError, type DomainErrorOptions } from './domain.error'

export class BadRequestError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'BAD_REQUEST',
			message ?? `${resource} is invalid`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class UnauthorizedError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'UNAUTHORIZED',
			message ?? `${resource} authentication required`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class ForbiddenError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'FORBIDDEN',
			message ?? `${resource} access denied`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class NotFoundError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'NOT_FOUND',
			message ?? `${resource} not found`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class ConflictError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'CONFLICT',
			message ?? `${resource} already exists`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class PayloadTooLargeError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'PAYLOAD_TOO_LARGE',
			message ?? `${resource} is too large`,
			'expected',
			{ ...context, resource },
			options
		)
	}
}

export class InternalError extends DomainError {
	constructor(
		resource: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'INTERNAL_SERVER_ERROR',
			message ?? `${resource} internal error`,
			'critical',
			{ ...context, resource },
			options
		)
	}
}

export class ExternalServiceError extends DomainError {
	constructor(
		service: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'BAD_GATEWAY',
			message ?? `${service} request failed`,
			'operational',
			{ ...context, service },
			options
		)
	}
}

export class ServiceUnavailableError extends DomainError {
	constructor(
		service: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'SERVICE_UNAVAILABLE',
			message ?? `${service} is unavailable`,
			'operational',
			{ ...context, service },
			options
		)
	}
}

export class GatewayTimeoutError extends DomainError {
	constructor(
		service: string,
		context?: Record<string, unknown>,
		message?: string,
		options?: DomainErrorOptions
	) {
		super(
			'GATEWAY_TIMEOUT',
			message ?? `${service} request timed out`,
			'operational',
			{ ...context, service },
			options
		)
	}
}

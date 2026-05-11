import type { CommonORPCErrorCode } from '@orpc/client'

export type ErrorSeverity = 'expected' | 'operational' | 'critical'

export interface DomainErrorOptions {
	cause?: unknown
}

export class DomainError extends Error {
	constructor(
		readonly code: CommonORPCErrorCode,
		message: string,
		readonly severity: ErrorSeverity,
		readonly context?: Record<string, unknown>,
		options?: DomainErrorOptions
	) {
		super(message, options)
		this.name = new.target.name
	}
}

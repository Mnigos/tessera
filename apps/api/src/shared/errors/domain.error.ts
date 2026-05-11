import type { SupportedORPCErrorCode } from '@config/rpc/http-status-code-map'

export type ErrorSeverity = 'expected' | 'operational' | 'critical'

export interface DomainErrorOptions {
	cause?: unknown
}

export class DomainError extends Error {
	constructor(
		readonly code: SupportedORPCErrorCode,
		message: string,
		readonly severity: ErrorSeverity,
		readonly context?: Record<string, unknown>,
		options?: DomainErrorOptions
	) {
		super(message, options)
		this.name = new.target.name
	}
}

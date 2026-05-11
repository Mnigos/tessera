import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import {
	DomainError,
	GatewayTimeoutError,
	InternalError,
	ServiceUnavailableError,
} from '@shared/errors'
import {
	httpStatusToOrpcCode,
	orpcCodeToHttpStatus,
} from './http-status-code-map'

const STACK_CALLER_PATTERN = /at\s+(\w+)\./
const exceptionResolutionLogger = new Logger('GlobalExceptionFilter')

interface DatabaseErrorShape {
	code: string
	severity: string
	detail?: string
}

interface ResolvedException {
	code: string
	message: string
	status: number
}

function isDatabaseError(error: unknown): error is DatabaseErrorShape {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		'severity' in error
	)
}

function extractSource(error: Error): string {
	if (!error.stack) return 'GlobalExceptionFilter'
	const frames = error.stack.split('\n').slice(1)
	const callerFrame = frames.find(
		frame => frame.includes('at ') && !frame.includes('shared/errors/')
	)
	if (!callerFrame) return 'GlobalExceptionFilter'
	const match = callerFrame.match(STACK_CALLER_PATTERN)
	return match?.[1] ?? 'GlobalExceptionFilter'
}

function logDomainError(error: DomainError): void {
	const source = extractSource(error)
	const context = error.context ? ` ${JSON.stringify(error.context)}` : ''
	const message = `${error.code}: ${error.message}${context}`

	if (error.severity === 'expected') {
		Logger.warn(message, source)
		return
	}

	if (error.severity === 'critical') {
		Logger.error(message, error.stack, source)
		return
	}

	Logger.error(message, undefined, source)
}

function mapDatabaseError(error: DatabaseErrorShape): DomainError {
	switch (error.code) {
		case '08006':
		case '08001':
			return new ServiceUnavailableError('database', { pgCode: error.code })
		case '57014':
			return new GatewayTimeoutError('database', { pgCode: error.code })
		case '40001':
			return new InternalError('database', { pgCode: error.code })
		default:
			return new InternalError('database', {
				pgCode: error.code,
				detail: error.detail,
			})
	}
}

function extractMessage(response: string | object): string {
	if (typeof response === 'string') return response
	if ('message' in response) {
		if (typeof response.message === 'string') return response.message
		if (Array.isArray(response.message)) return response.message.join(', ')
	}
	return 'Unknown error'
}

function stringifyException(exception: unknown): string {
	if (exception instanceof Error) return exception.stack ?? exception.message

	try {
		return JSON.stringify(exception)
	} catch {
		return String(exception)
	}
}

export function resolveException(exception: unknown): ResolvedException {
	if (exception instanceof DomainError) {
		logDomainError(exception)

		return {
			code: exception.code,
			message: exception.message,
			status: orpcCodeToHttpStatus(exception.code),
		}
	}

	if (isDatabaseError(exception)) {
		const error = mapDatabaseError(exception)
		logDomainError(error)

		return {
			code: error.code,
			message: error.message,
			status: orpcCodeToHttpStatus(error.code),
		}
	}

	if (exception instanceof ORPCError) {
		const status = orpcCodeToHttpStatus(exception.code)

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR)
			exceptionResolutionLogger.error(`${exception.code}: ${exception.message}`)
		else
			exceptionResolutionLogger.warn(`${exception.code}: ${exception.message}`)

		return {
			code: exception.code,
			message: exception.message,
			status,
		}
	}

	if (exception instanceof HttpException) {
		const status = exception.getStatus()
		const code = httpStatusToOrpcCode(status)
		const message = extractMessage(exception.getResponse())

		if (status >= HttpStatus.INTERNAL_SERVER_ERROR)
			exceptionResolutionLogger.error(`${code}: ${message}`)
		else exceptionResolutionLogger.warn(`${code}: ${message}`)

		return { code, message, status }
	}

	exceptionResolutionLogger.error(
		'Unhandled exception',
		stringifyException(exception)
	)

	return {
		code: 'INTERNAL_SERVER_ERROR',
		message: 'Internal server error',
		status: HttpStatus.INTERNAL_SERVER_ERROR,
	}
}

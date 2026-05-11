import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import postgres from 'postgres'
import { NotFoundError, ServiceUnavailableError } from '~/shared/errors'
import { resolveException } from './exception-resolution.helper'

const { PostgresError } = postgres

function createPostgresError(code: string): postgres.PostgresError {
	return new PostgresError({
		severity_local: 'ERROR',
		severity: 'ERROR',
		code,
		message: 'test error',
		detail: '',
		position: '',
		file: '',
		line: '',
		routine: '',
	} as unknown as string)
}

describe(resolveException.name, () => {
	beforeEach(() => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('maps expected domain errors without transport coupling', () => {
		expect(resolveException(new NotFoundError('profile'))).toEqual({
			code: 'NOT_FOUND',
			message: 'profile not found',
			status: HttpStatus.NOT_FOUND,
		})
		expect(Logger.warn).toHaveBeenCalledWith(
			'NOT_FOUND: profile not found {"resource":"profile"}',
			expect.any(String)
		)
	})

	test('maps operational domain errors', () => {
		expect(resolveException(new ServiceUnavailableError('database'))).toEqual({
			code: 'SERVICE_UNAVAILABLE',
			message: 'database is unavailable',
			status: HttpStatus.SERVICE_UNAVAILABLE,
		})
		expect(Logger.error).toHaveBeenCalled()
	})

	test('maps postgres connection failures to service unavailable', () => {
		expect(resolveException(createPostgresError('08001'))).toEqual({
			code: 'SERVICE_UNAVAILABLE',
			message: 'database is unavailable',
			status: HttpStatus.SERVICE_UNAVAILABLE,
		})
	})

	test('preserves oRPC errors at the transport boundary', () => {
		expect(
			resolveException(
				new ORPCError('BAD_REQUEST', { message: 'Invalid payload' })
			)
		).toEqual({
			code: 'BAD_REQUEST',
			message: 'Invalid payload',
			status: HttpStatus.BAD_REQUEST,
		})
		expect(Logger.prototype.warn).toHaveBeenCalledWith(
			'BAD_REQUEST: Invalid payload'
		)
	})

	test('normalizes Nest HTTP exception messages', () => {
		expect(
			resolveException(
				new HttpException(
					{ message: ['first message', 'second message'] },
					HttpStatus.BAD_REQUEST
				)
			)
		).toEqual({
			code: 'BAD_REQUEST',
			message: 'first message, second message',
			status: HttpStatus.BAD_REQUEST,
		})
	})

	test('hides unknown exception messages', () => {
		expect(resolveException(new Error('boom'))).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Internal server error',
			status: HttpStatus.INTERNAL_SERVER_ERROR,
		})
		expect(Logger.prototype.error).toHaveBeenCalled()
	})

	test('logs non-error exception objects with structured details', () => {
		expect(resolveException({ reason: 'boom' })).toEqual({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Internal server error',
			status: HttpStatus.INTERNAL_SERVER_ERROR,
		})
		expect(Logger.prototype.error).toHaveBeenCalledWith(
			'Unhandled exception',
			'{"reason":"boom"}'
		)
	})
})

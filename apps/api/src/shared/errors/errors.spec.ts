import { DomainError } from './domain.error'
import {
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	ServiceUnavailableError,
} from './errors'

describe('domain errors', () => {
	test('creates expected not found errors with resource context', () => {
		const error = new NotFoundError('profile', { username: 'missing-user' })

		expect(error).toBeInstanceOf(DomainError)
		expect(error.name).toBe('NotFoundError')
		expect(error.code).toBe('NOT_FOUND')
		expect(error.message).toBe('profile not found')
		expect(error.severity).toBe('expected')
		expect(error.context).toEqual({
			resource: 'profile',
			username: 'missing-user',
		})
	})

	test('supports custom public messages', () => {
		expect(
			new ConflictError('username', undefined, 'Username taken')
		).toMatchObject({
			code: 'CONFLICT',
			message: 'Username taken',
			severity: 'expected',
		})
		expect(new ForbiddenError('repository')).toMatchObject({
			code: 'FORBIDDEN',
			message: 'repository access denied',
		})
	})

	test('keeps canonical metadata when context contains reserved keys', () => {
		expect(
			new NotFoundError('profile', { resource: 'other-resource' }).context
		).toEqual({
			resource: 'profile',
		})
		expect(
			new ServiceUnavailableError('database', { service: 'other-service' })
				.context
		).toEqual({
			service: 'database',
		})
	})

	test('separates operational and critical failures', () => {
		expect(new ServiceUnavailableError('database')).toMatchObject({
			code: 'SERVICE_UNAVAILABLE',
			severity: 'operational',
		})
		expect(new InternalError('database')).toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			severity: 'critical',
		})
	})
})

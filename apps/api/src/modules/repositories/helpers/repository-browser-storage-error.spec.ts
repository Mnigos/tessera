import { status } from '@grpc/grpc-js'
import type { RepositorySlug } from '@repo/domain'
import { ExternalServiceError, PayloadTooLargeError } from '~/shared/errors'
import {
	RepositoryBrowserInvalidRequestError,
	RepositoryNotFoundError,
} from '../domain/repository.errors'
import {
	type RepositoryBrowserStorageErrorContext,
	toRepositoryBrowserReadError,
} from './repository-browser-storage-error'

const context: RepositoryBrowserStorageErrorContext = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	ref: 'main',
	path: 'src/index.ts',
}

describe(toRepositoryBrowserReadError.name, () => {
	test('maps missing and wrong-kind storage errors to repository misses', () => {
		expect(
			toRepositoryBrowserReadError(
				new ExternalServiceError('git storage', {
					grpcCode: status.NOT_FOUND,
				}),
				context
			)
		).toBeInstanceOf(RepositoryNotFoundError)
		expect(
			toRepositoryBrowserReadError(
				new ExternalServiceError('git storage', {
					grpcCode: status.FAILED_PRECONDITION,
				}),
				context
			)
		).toBeInstanceOf(RepositoryNotFoundError)
	})

	test('maps invalid storage requests to browser invalid request errors', () => {
		expect(
			toRepositoryBrowserReadError(
				new ExternalServiceError('git storage', {
					grpcCode: status.INVALID_ARGUMENT,
				}),
				context
			)
		).toBeInstanceOf(RepositoryBrowserInvalidRequestError)
	})

	test('maps exhausted storage responses to payload too large errors', () => {
		expect(
			toRepositoryBrowserReadError(
				new ExternalServiceError('git storage', {
					grpcCode: status.RESOURCE_EXHAUSTED,
				}),
				context
			)
		).toBeInstanceOf(PayloadTooLargeError)
	})

	test('passes through unrelated errors', () => {
		const error = new Error('boom')
		const externalError = new ExternalServiceError('git storage', {
			grpcCode: status.UNAVAILABLE,
		})

		expect(toRepositoryBrowserReadError(error, context)).toBe(error)
		expect(toRepositoryBrowserReadError(externalError, context)).toBe(
			externalError
		)
	})
})

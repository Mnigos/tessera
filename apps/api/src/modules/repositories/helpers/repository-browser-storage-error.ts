import { status } from '@grpc/grpc-js'
import type { RepositorySlug } from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import {
	RepositoryBrowserInvalidRequestError,
	RepositoryNotFoundError,
} from '../domain/repository.errors'

export interface RepositoryBrowserStorageErrorContext {
	path: string
	ref: string
	slug: RepositorySlug
	username: string
}

/**
 * Maps Git storage browser-read failures into repository API errors.
 */
export function toRepositoryBrowserReadError(
	error: unknown,
	context: RepositoryBrowserStorageErrorContext
) {
	if (!(error instanceof ExternalServiceError)) return error

	const grpcCode = error.context?.grpcCode

	if (grpcCode === status.NOT_FOUND || grpcCode === status.FAILED_PRECONDITION)
		return new RepositoryNotFoundError({
			...context,
			grpcCode,
		})

	if (grpcCode === status.INVALID_ARGUMENT)
		return new RepositoryBrowserInvalidRequestError({
			...context,
			grpcCode,
		})

	return error
}

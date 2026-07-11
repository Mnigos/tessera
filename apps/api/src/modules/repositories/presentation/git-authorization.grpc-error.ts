import { status } from '@grpc/grpc-js'
import { DomainError } from '~/shared/errors/domain.error'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'
import {
	createGitAuthorizationRpcException,
	isGitAuthorizationRpcException,
} from './git-authorization.grpc-status'

export function toGitAuthorizationGrpcException(error: unknown) {
	if (isGitAuthorizationRpcException(error)) return error

	return createGitAuthorizationRpcException(
		getGitAuthorizationGrpcStatus(error),
		error instanceof DomainError ? error.message : 'Internal error'
	)
}

function getGitAuthorizationGrpcStatus(error: unknown) {
	if (!(error instanceof DomainError)) return status.INTERNAL

	if (error instanceof RepositoryStoragePathMissingError)
		return status.FAILED_PRECONDITION
	if (error.code === 'UNAUTHORIZED') return status.UNAUTHENTICATED
	if (error.code === 'FORBIDDEN') return status.PERMISSION_DENIED
	if (error.code === 'NOT_FOUND') return status.NOT_FOUND

	return status.INTERNAL
}

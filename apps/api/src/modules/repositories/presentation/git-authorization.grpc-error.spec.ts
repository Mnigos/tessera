import { status } from '@grpc/grpc-js'
import {
	ForbiddenError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'
import { toGitAuthorizationGrpcException } from './git-authorization.grpc-error'

describe('git authorization gRPC error mapping', () => {
	test.each([
		[new UnauthorizedError('git authorization'), status.UNAUTHENTICATED],
		[new ForbiddenError('repository git write'), status.PERMISSION_DENIED],
		[new NotFoundError('repository'), status.NOT_FOUND],
		[new RepositoryStoragePathMissingError(), status.FAILED_PRECONDITION],
		[new Error('boom'), status.INTERNAL],
	] as const)('maps errors to gRPC statuses', (error, expectedStatus) => {
		expect(toGitAuthorizationGrpcException(error)).toMatchObject({
			error: expect.objectContaining({ code: expectedStatus }),
		})
	})

	test('hides unexpected internal error details', () => {
		expect(
			toGitAuthorizationGrpcException(new Error('database failed'))
		).toMatchObject({
			error: expect.objectContaining({
				code: status.INTERNAL,
				message: 'Internal error',
			}),
		})
	})
})

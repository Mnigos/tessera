import { status } from '@grpc/grpc-js'
import { ExternalServiceError } from '~/shared/errors'
import {
	PullRequestMergeConflictError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'

interface PullRequestStorageErrorContext {
	number: number
	repositoryId: string
}

export function toPullRequestStorageError(
	error: unknown,
	context: PullRequestStorageErrorContext
) {
	if (!(error instanceof ExternalServiceError)) return error

	const grpcCode = error.context?.grpcCode

	if (grpcCode === status.ABORTED)
		return new PullRequestStaleComparisonError({ ...context, grpcCode })

	if (
		grpcCode === status.FAILED_PRECONDITION &&
		error.context?.grpcDetails === 'repository refs cannot be merged cleanly'
	)
		return new PullRequestMergeConflictError({ ...context, grpcCode })

	return error
}

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

/**
 * A revision git storage does not hold, as opposed to storage failing to answer
 * or refusing the request. The client wraps every unmapped gRPC failure the
 * same way, so the code it carried is all that separates a commit that is gone
 * from a service that is broken.
 */
export function isMissingGitObjectError(error: unknown): boolean {
	if (!(error instanceof ExternalServiceError)) return false

	return error.context?.grpcCode === status.NOT_FOUND
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

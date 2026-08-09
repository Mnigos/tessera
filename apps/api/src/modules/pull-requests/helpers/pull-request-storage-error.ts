import { status } from '@grpc/grpc-js'
import type {
	MergeStrategy,
	MergeStrategyUnavailableReason,
} from '@repo/domain'
import { mergeStrategyUnavailableReasons } from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import {
	PullRequestMergeConflictError,
	PullRequestMergeStrategyUnavailableError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'

interface PullRequestStorageErrorContext {
	number: number
	repositoryId: string
}

const MERGE_CONFLICT_DETAILS = 'repository refs cannot be merged cleanly'
/**
 * Git storage names the strategy it refused in the status message, because gRPC
 * gives a failed precondition nowhere else to put it. The producing side is
 * `RepositoryError::MergeStrategyUnavailable` in `services/git`; the prefix and
 * the reason names have to change together with it.
 */
const STRATEGY_UNAVAILABLE_DETAILS_PREFIX =
	'repository merge strategy is unavailable: '

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
	context: PullRequestStorageErrorContext,
	strategy?: MergeStrategy
) {
	if (!(error instanceof ExternalServiceError)) return error

	const grpcCode = error.context?.grpcCode

	if (grpcCode === status.ABORTED)
		return new PullRequestStaleComparisonError({ ...context, grpcCode })

	if (grpcCode !== status.FAILED_PRECONDITION) return error

	const details = error.context?.grpcDetails

	if (details === MERGE_CONFLICT_DETAILS)
		return new PullRequestMergeConflictError({ ...context, grpcCode })

	const unavailableReason = toStrategyUnavailableReason(details)

	if (unavailableReason && strategy)
		return new PullRequestMergeStrategyUnavailableError(
			strategy,
			unavailableReason,
			{ ...context, grpcCode }
		)

	return error
}

function toStrategyUnavailableReason(
	details: unknown
): MergeStrategyUnavailableReason | undefined {
	if (typeof details !== 'string') return undefined
	if (!details.startsWith(STRATEGY_UNAVAILABLE_DETAILS_PREFIX)) return undefined

	const reason = details.slice(STRATEGY_UNAVAILABLE_DETAILS_PREFIX.length)

	return mergeStrategyUnavailableReasons.find(candidate => candidate === reason)
}

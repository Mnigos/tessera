import { ORPCError } from '@orpc/client'
import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'

const PULL_REQUEST_ERROR_STATUSES = new Set([400, 409])

export function getPullRequestErrorMessage(error: unknown, fallback: string) {
	if (
		error instanceof ORPCError &&
		PULL_REQUEST_ERROR_STATUSES.has(error.status) &&
		error.message
	)
		return error.message

	return fallback
}

export function isPullRequestStaleComparisonError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.status === 409 &&
		error.message === PULL_REQUEST_STALE_COMPARISON_MESSAGE
	)
}

import { ORPCError } from '@orpc/client'
import {
	PULL_REQUEST_STALE_COMPARISON_MESSAGE,
	REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE,
} from '@repo/contracts'

const PULL_REQUEST_ERROR_STATUSES = new Set([400, 409])

/**
 * A repository that cut over to GitHub while the page was open answers every
 * mutation with the same refusal. It says where the change belongs, which the
 * generic per-action fallback cannot, so it is surfaced despite being a 403.
 */
export function getPullRequestErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof ORPCError && error.message)) return fallback

	if (error.message === REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE)
		return error.message

	return PULL_REQUEST_ERROR_STATUSES.has(error.status)
		? error.message
		: fallback
}

export function isPullRequestStaleComparisonError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.status === 409 &&
		error.message === PULL_REQUEST_STALE_COMPARISON_MESSAGE
	)
}

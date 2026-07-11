import { ORPCError } from '@orpc/client'

const pullRequestErrorStatuses = new Set([400, 409])

export function getPullRequestErrorMessage(error: unknown, fallback: string) {
	if (
		error instanceof ORPCError &&
		pullRequestErrorStatuses.has(error.status) &&
		error.message
	)
		return error.message

	return fallback
}

export function isPullRequestStaleComparisonError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.status === 409 &&
		error.message ===
			'The source or target branch changed. Refresh the pull request and try again.'
	)
}

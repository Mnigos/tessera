import { ORPCError } from '@orpc/client'
import {
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
	PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE,
	PULL_REQUEST_STALE_COMPARISON_MESSAGE,
	REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE,
} from '@repo/contracts'

const PULL_REQUEST_ERROR_STATUSES = new Set([400, 409])

// Refusals worth more than the per-action fallback, whatever status they carry.
const PULL_REQUEST_EXPLAINED_MESSAGES = new Set<string>([
	REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE,
	PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	...Object.values(GITHUB_WRITE_REJECTED_MESSAGES),
])

export function getPullRequestErrorMessage(error: unknown, fallback: string) {
	if (!(error instanceof ORPCError && error.message)) return fallback

	if (PULL_REQUEST_EXPLAINED_MESSAGES.has(error.message)) return error.message

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

// GitHub accepted the write; only Tessera's copy of it is late.
export function isGitHubSyncDelayedError(error: unknown) {
	return (
		error instanceof ORPCError && error.message === GITHUB_SYNC_DELAYED_MESSAGE
	)
}

export function isGitHubReconnectRequiredError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.message === GITHUB_RECONNECT_REQUIRED_MESSAGE
	)
}

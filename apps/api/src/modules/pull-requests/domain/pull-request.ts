import type {
	PullRequestEvent as PullRequestEventOutput,
	PullRequest as PullRequestOutput,
} from '@repo/contracts'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import { PullRequestStateConflictError } from './pull-request.errors'

export function toPullRequestOutput(
	pullRequest: PullRequest
): PullRequestOutput {
	return {
		...pullRequest,
		mergeCommitSha: pullRequest.mergeCommitSha ?? undefined,
		mergeActorUserId: pullRequest.mergeActorUserId ?? undefined,
		closedAt: pullRequest.closedAt ?? undefined,
		mergedAt: pullRequest.mergedAt ?? undefined,
	}
}

export function toPullRequestEventOutput(
	event: PullRequestEvent
): PullRequestEventOutput {
	return event
}

export function assertPullRequestEditable(
	pullRequest: PullRequest
): asserts pullRequest is PullRequest & { state: 'open' | 'closed' } {
	if (pullRequest.state !== 'merged') return

	throw new PullRequestStateConflictError({
		pullRequestId: pullRequest.id,
		state: pullRequest.state,
		action: 'edit',
	})
}

export function assertPullRequestClosable(
	pullRequest: PullRequest
): asserts pullRequest is PullRequest & { state: 'open' } {
	if (pullRequest.state === 'open') return

	throw new PullRequestStateConflictError({
		pullRequestId: pullRequest.id,
		state: pullRequest.state,
		action: 'close',
	})
}

export function assertPullRequestReopenable(
	pullRequest: PullRequest
): asserts pullRequest is PullRequest & { state: 'closed' } {
	if (pullRequest.state === 'closed') return

	throw new PullRequestStateConflictError({
		pullRequestId: pullRequest.id,
		state: pullRequest.state,
		action: 'reopen',
	})
}

import type {
	PullRequestEvent as PullRequestEventOutput,
	PullRequest as PullRequestOutput,
} from '@repo/contracts'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import type {
	PullRequestEventReadModel,
	PullRequestReadModel,
} from '../infrastructure/pull-requests.repository'
import { PullRequestStateConflictError } from './pull-request.errors'

export function toPullRequestOutput(
	pullRequest: PullRequest | PullRequestReadModel,
	authorUsername?: string
): PullRequestOutput {
	const resolvedAuthorUsername =
		('authorUsername' in pullRequest
			? pullRequest.authorUsername
			: undefined) ?? authorUsername

	if (!resolvedAuthorUsername)
		throw new Error('pull request author username is unavailable')

	return {
		...pullRequest,
		authorUserId: pullRequest.authorUserId ?? undefined,
		authorUsername: resolvedAuthorUsername,
		mergeCommitSha: pullRequest.mergeCommitSha ?? undefined,
		mergeActorUserId: pullRequest.mergeActorUserId ?? undefined,
		closedAt: pullRequest.closedAt ?? undefined,
		mergedAt: pullRequest.mergedAt ?? undefined,
		github: 'github' in pullRequest ? pullRequest.github : undefined,
	}
}

export function toPullRequestEventOutput(
	event: PullRequestEvent | PullRequestEventReadModel,
	actorUsername?: string
): PullRequestEventOutput {
	const resolvedActorUsername =
		('actorUsername' in event ? event.actorUsername : undefined) ??
		actorUsername

	if (!resolvedActorUsername)
		throw new Error('pull request event actor username is unavailable')

	return {
		...event,
		actorUserId: event.actorUserId ?? undefined,
		actorUsername: resolvedActorUsername,
	}
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

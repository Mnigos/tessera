import type {
	PullRequestEvent as PullRequestEventOutput,
	PullRequest as PullRequestOutput,
} from '@repo/contracts'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import type { UserId } from '@repo/domain'
import type {
	PullRequestEventReadModel,
	PullRequestReadModel,
} from '../infrastructure/pull-requests.repository'
import { PullRequestStateConflictError } from './pull-request.errors'
import { toPullRequestActorOutput } from './pull-request-actor'

const SYSTEM_ACTOR_EVENT_TYPES: ReadonlySet<PullRequestEvent['type']> = new Set(
	['queue_paused', 'queue_removed', 'queue_resumed']
)

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
		mergeStrategy: pullRequest.mergeStrategy ?? undefined,
		mergeActorUserId: pullRequest.mergeActorUserId ?? undefined,
		closedAt: pullRequest.closedAt ?? undefined,
		mergedAt: pullRequest.mergedAt ?? undefined,
		diffStats:
			pullRequest.diffAdditions === null ||
			pullRequest.diffDeletions === null ||
			pullRequest.diffChangedFiles === null
				? undefined
				: {
						additions: pullRequest.diffAdditions,
						deletions: pullRequest.diffDeletions,
						changedFiles: pullRequest.diffChangedFiles,
					},
		github: 'github' in pullRequest ? pullRequest.github : undefined,
	}
}

/**
 * Who opened the pull request, as an account. A synchronized row stores no
 * author user, so the answer is the account the author's GitHub identity is
 * linked to — without it, a mirrored author would pass every authorship gate.
 */
export function getPullRequestAuthorUserId(
	pullRequest: PullRequestReadModel
): UserId | null {
	return pullRequest.authorUserId ?? pullRequest.authorActorUserId ?? null
}

export function toPullRequestEventOutput(
	event: PullRequestEvent | PullRequestEventReadModel,
	actorUsername?: string
): PullRequestEventOutput {
	const resolvedActorUsername =
		('actorUsername' in event ? event.actorUsername : undefined) ??
		actorUsername

	// Queue transitions written by the worker or the reconciler have no acting
	// user; every other Tessera event must name one.
	if (!(resolvedActorUsername || SYSTEM_ACTOR_EVENT_TYPES.has(event.type)))
		throw new Error('pull request event actor username is unavailable')

	return {
		...event,
		actorUserId: event.actorUserId ?? undefined,
		actorUsername: resolvedActorUsername ?? undefined,
		actor:
			'actor' in event && event.actor
				? toPullRequestActorOutput(event.actor)
				: undefined,
		payload: event.payload ?? undefined,
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

export function assertPullRequestRetargetable(
	pullRequest: PullRequest
): asserts pullRequest is PullRequest & { state: 'open' } {
	if (pullRequest.state === 'open') return

	throw new PullRequestStateConflictError({
		pullRequestId: pullRequest.id,
		state: pullRequest.state,
		action: 'retarget',
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

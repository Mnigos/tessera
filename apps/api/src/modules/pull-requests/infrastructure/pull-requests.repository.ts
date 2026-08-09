import { Database } from '@config/database'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import type { GitHubPendingPullRequestEvent } from '@modules/github-sync/infrastructure/github-sync.repository'
import { Injectable } from '@nestjs/common'
import type { GitHubActorId, GitHubWebhookDeliveryId } from '@repo/db'
import {
	and,
	asc,
	type DrizzleTransaction,
	desc,
	eq,
	gitHubActors,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	inArray,
	lte,
	ne,
	type PullRequest,
	type PullRequestEvent,
	type PullRequestEventPayload,
	type PullRequestMergeBlockedEventPayload,
	type PullRequestMergeBypass,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositoryPullRequestCounters,
	sql,
	user,
} from '@repo/db'
import type {
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { alias } from 'drizzle-orm/pg-core'
import type { PullRequestPushRefUpdate } from '../domain/pull-request-push.schema'
import {
	completeMergeQueueEntry,
	removeActiveMergeQueueEntry,
} from './merge-queue.transactions'

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface PullRequestNumberParams extends RepositoryParams {
	number: number
}

interface ListParams extends RepositoryParams {
	state?: PullRequest['state']
}

interface CreateParams extends RepositoryParams {
	authorUserId: UserId
	sourceBranch: string
	targetBranch: string
	openingBaseSha: string
	openingHeadSha: string
	title: string
	body: string
}

interface ReconcileGitHubPullRequestParams extends RepositoryParams {
	pullRequest: GitHubSyncPullRequest
	authorActorId: GitHubActorId
	mergedByActorId?: GitHubActorId
	pendingEvents: GitHubPendingPullRequestEvent[]
}

interface PullRequestMutationParams extends RepositoryParams {
	pullRequestId: PullRequestId
	actorUserId: UserId
}

interface EditParams extends PullRequestMutationParams {
	expectedState: 'open' | 'closed'
	title?: string
	body?: string
}

interface LifecycleParams extends PullRequestMutationParams {
	changedAt: Date
}

interface CloseParams extends LifecycleParams {
	staleBefore: Date
}

interface ClaimMergeParams extends PullRequestMutationParams {
	attemptId: string
	/** Present only when the attempt is deliberately merging past policy. */
	bypass?: PullRequestMergeBypass
	staleBefore: Date
	startedAt: Date
}

interface RecordMergeBlockedParams {
	actorUserId: UserId
	payload: PullRequestMergeBlockedEventPayload
	pullRequestId: PullRequestId
}

interface CompleteMergeParams extends LifecycleParams {
	attemptId: string
	mergeCommitSha: string
	/** Present when a queue run made this merge, so its entry finishes with it. */
	queueEntryId?: MergeQueueEntryId
}

interface ReleaseMergeParams extends PullRequestMutationParams {
	attemptId: string
}

interface CreatePushEventsParams extends RepositoryParams {
	actorUserId: UserId
	operationId: string
	occurredAt: Date
	updates: PullRequestPushRefUpdate[]
}

type PullRequestDatabase = Database | DrizzleTransaction

export interface PullRequestReadModel extends PullRequest {
	authorUsername?: string
	/** The author's GitHub identity, present whether or not it maps to a user. */
	authorActorNodeId?: string
	github?: {
		nodeId: string
		htmlUrl: string
		draft: boolean
		headSha: string
		baseSha: string
		mergedByUsername?: string
	}
}

/** The delivery key is write-side bookkeeping and never part of the timeline. */
export interface PullRequestEventReadModel
	extends Omit<PullRequestEvent, 'idempotencyKey'> {
	actorUsername?: string
}

interface PullRequestReadRow extends PullRequest {
	authorUsername: string
	authorActorNodeId: string | null
	githubNodeId: string | null
	githubHtmlUrl: string | null
	githubDraft: boolean | null
	githubHeadSha: string | null
	githubBaseSha: string | null
	githubMergedByUsername: string | null
}

const PULL_REQUEST_COLUMNS = {
	id: pullRequests.id,
	repositoryId: pullRequests.repositoryId,
	provider: pullRequests.provider,
	number: pullRequests.number,
	authorUserId: pullRequests.authorUserId,
	sourceBranch: pullRequests.sourceBranch,
	targetBranch: pullRequests.targetBranch,
	openingBaseSha: pullRequests.openingBaseSha,
	openingHeadSha: pullRequests.openingHeadSha,
	title: pullRequests.title,
	body: pullRequests.body,
	state: pullRequests.state,
	mergeCommitSha: pullRequests.mergeCommitSha,
	mergeActorUserId: pullRequests.mergeActorUserId,
	createdAt: pullRequests.createdAt,
	updatedAt: pullRequests.updatedAt,
	closedAt: pullRequests.closedAt,
	mergedAt: pullRequests.mergedAt,
}

const authorUser = alias(user, 'pull_request_author_user')
const authorGitHubActor = alias(
	gitHubActors,
	'pull_request_author_github_actor'
)
const mergedByGitHubActor = alias(
	gitHubActors,
	'pull_request_merged_by_github_actor'
)
const eventActorUser = alias(user, 'pull_request_event_actor_user')
const eventGitHubActor = alias(gitHubActors, 'pull_request_event_github_actor')

const PULL_REQUEST_READ_COLUMNS = {
	...PULL_REQUEST_COLUMNS,
	authorUsername: sql<string>`coalesce(${authorUser.username}, ${authorGitHubActor.login})`,
	authorActorNodeId: authorGitHubActor.externalNodeId,
	githubNodeId: gitHubPullRequestMappings.externalNodeId,
	githubHtmlUrl: gitHubPullRequestMappings.htmlUrl,
	githubDraft: gitHubPullRequestMappings.draft,
	githubHeadSha: gitHubPullRequestMappings.headSha,
	githubBaseSha: gitHubPullRequestMappings.baseSha,
	githubMergedByUsername: mergedByGitHubActor.login,
}

@Injectable()
export class PullRequestsRepository {
	constructor(private readonly db: Database) {}

	async create(params: CreateParams): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			const number = await this.allocatePullRequestNumber(
				tx,
				params.repositoryId
			)
			if (!number) return undefined

			const [pullRequest] = await tx
				.insert(pullRequests)
				.values({
					repositoryId: params.repositoryId,
					number,
					authorUserId: params.authorUserId,
					sourceBranch: params.sourceBranch,
					targetBranch: params.targetBranch,
					openingBaseSha: params.openingBaseSha,
					openingHeadSha: params.openingHeadSha,
					title: params.title,
					body: params.body,
				})
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return undefined

			await this.createEvent(tx, {
				pullRequestId: pullRequest.id,
				actorUserId: params.authorUserId,
				type: 'opened',
			})

			return pullRequest
		})
	}

	async list({
		repositoryId,
		state,
	}: ListParams): Promise<PullRequestReadModel[]> {
		const conditions = [eq(pullRequests.repositoryId, repositoryId)]

		if (state) conditions.push(eq(pullRequests.state, state))

		const rows = await this.db
			.select(PULL_REQUEST_READ_COLUMNS)
			.from(pullRequests)
			.leftJoin(authorUser, eq(authorUser.id, pullRequests.authorUserId))
			.leftJoin(
				gitHubPullRequestMappings,
				eq(gitHubPullRequestMappings.pullRequestId, pullRequests.id)
			)
			.leftJoin(
				authorGitHubActor,
				eq(authorGitHubActor.id, gitHubPullRequestMappings.authorActorId)
			)
			.leftJoin(
				mergedByGitHubActor,
				eq(mergedByGitHubActor.id, gitHubPullRequestMappings.mergedByActorId)
			)
			.where(and(...conditions))
			.orderBy(desc(pullRequests.number))

		return rows.map(toPullRequestReadModel)
	}

	async find({
		number,
		repositoryId,
	}: PullRequestNumberParams): Promise<PullRequestReadModel | undefined> {
		const [pullRequest] = await this.db
			.select(PULL_REQUEST_READ_COLUMNS)
			.from(pullRequests)
			.leftJoin(authorUser, eq(authorUser.id, pullRequests.authorUserId))
			.leftJoin(
				gitHubPullRequestMappings,
				eq(gitHubPullRequestMappings.pullRequestId, pullRequests.id)
			)
			.leftJoin(
				authorGitHubActor,
				eq(authorGitHubActor.id, gitHubPullRequestMappings.authorActorId)
			)
			.leftJoin(
				mergedByGitHubActor,
				eq(mergedByGitHubActor.id, gitHubPullRequestMappings.mergedByActorId)
			)
			.where(
				and(
					eq(pullRequests.repositoryId, repositoryId),
					eq(pullRequests.number, number)
				)
			)
			.limit(1)

		return pullRequest ? toPullRequestReadModel(pullRequest) : undefined
	}

	/**
	 * The same read as `find`, addressed by identity rather than by number. The
	 * merge queue holds pull request ids and never sees the repository-scoped
	 * number a URL carries.
	 */
	async findById({
		pullRequestId,
	}: Pick<PullRequestMutationParams, 'pullRequestId'>): Promise<
		PullRequestReadModel | undefined
	> {
		const [pullRequest] = await this.db
			.select(PULL_REQUEST_READ_COLUMNS)
			.from(pullRequests)
			.leftJoin(authorUser, eq(authorUser.id, pullRequests.authorUserId))
			.leftJoin(
				gitHubPullRequestMappings,
				eq(gitHubPullRequestMappings.pullRequestId, pullRequests.id)
			)
			.leftJoin(
				authorGitHubActor,
				eq(authorGitHubActor.id, gitHubPullRequestMappings.authorActorId)
			)
			.leftJoin(
				mergedByGitHubActor,
				eq(mergedByGitHubActor.id, gitHubPullRequestMappings.mergedByActorId)
			)
			.where(eq(pullRequests.id, pullRequestId))
			.limit(1)

		return pullRequest ? toPullRequestReadModel(pullRequest) : undefined
	}

	async listEvents({
		pullRequestId,
	}: Pick<PullRequestMutationParams, 'pullRequestId'>): Promise<
		PullRequestEventReadModel[]
	> {
		return await this.db
			.select({
				id: pullRequestEvents.id,
				pullRequestId: pullRequestEvents.pullRequestId,
				provider: pullRequestEvents.provider,
				actorUserId: pullRequestEvents.actorUserId,
				type: pullRequestEvents.type,
				payload: pullRequestEvents.payload,
				createdAt: pullRequestEvents.createdAt,
				actorUsername: sql<string>`coalesce(${eventActorUser.username}, ${eventGitHubActor.login})`,
			})
			.from(pullRequestEvents)
			.leftJoin(
				eventActorUser,
				eq(eventActorUser.id, pullRequestEvents.actorUserId)
			)
			.leftJoin(
				gitHubPullRequestEventMappings,
				eq(
					gitHubPullRequestEventMappings.pullRequestEventId,
					pullRequestEvents.id
				)
			)
			.leftJoin(
				eventGitHubActor,
				eq(eventGitHubActor.id, gitHubPullRequestEventMappings.actorId)
			)
			.where(eq(pullRequestEvents.pullRequestId, pullRequestId))
			.orderBy(
				asc(pullRequestEvents.createdAt),
				// `merge_bypassed` and `merged` are written in one transaction and
				// therefore share its timestamp. The waiver is what explains the merge,
				// so it is placed first; the id then breaks any remaining tie, because a
				// timeline that reshuffles between two reads of the same rows is worse
				// than one whose order is arbitrary but fixed.
				sql`case when ${pullRequestEvents.type} = 'merge_bypassed' then 0 else 1 end`,
				asc(pullRequestEvents.id)
			)
	}

	async reconcileGitHubPullRequest({
		authorActorId,
		mergedByActorId,
		pendingEvents,
		pullRequest,
		repositoryId,
	}: ReconcileGitHubPullRequestParams): Promise<void> {
		await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${pullRequest.nodeId}, 0))`
			)
			const [existingMapping] = await transaction
				.select({
					pullRequestId: gitHubPullRequestMappings.pullRequestId,
					repositoryId: gitHubPullRequestMappings.repositoryId,
				})
				.from(gitHubPullRequestMappings)
				.where(eq(gitHubPullRequestMappings.externalNodeId, pullRequest.nodeId))
				.limit(1)
				.for('update')

			if (existingMapping && existingMapping.repositoryId !== repositoryId)
				throw new Error(
					'GitHub pull request mapping belongs to another repository'
				)

			const pullRequestId = existingMapping?.pullRequestId
				? await this.updateGitHubPullRequest(transaction, {
						pullRequestId: existingMapping.pullRequestId,
						pullRequest,
					})
				: await this.createGitHubPullRequest(transaction, {
						repositoryId,
						pullRequest,
					})

			await transaction
				.insert(gitHubPullRequestMappings)
				.values({
					repositoryId,
					pullRequestId,
					externalNodeId: pullRequest.nodeId,
					externalNumericId: pullRequest.numericId,
					externalNumber: pullRequest.number,
					htmlUrl: pullRequest.htmlUrl,
					authorActorId,
					mergedByActorId,
					headRepositoryNodeId: pullRequest.headRepositoryNodeId,
					baseRepositoryNodeId: pullRequest.baseRepositoryNodeId,
					headSha: pullRequest.headSha,
					baseSha: pullRequest.baseSha,
					draft: pullRequest.draft,
					providerCreatedAt: pullRequest.createdAt,
					providerUpdatedAt: pullRequest.updatedAt,
					providerClosedAt: pullRequest.closedAt,
					providerMergedAt: pullRequest.mergedAt,
					lastSyncedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: gitHubPullRequestMappings.externalNodeId,
					set: {
						externalNumericId: pullRequest.numericId,
						externalNumber: pullRequest.number,
						htmlUrl: pullRequest.htmlUrl,
						authorActorId,
						mergedByActorId,
						headRepositoryNodeId: pullRequest.headRepositoryNodeId,
						baseRepositoryNodeId: pullRequest.baseRepositoryNodeId,
						headSha: pullRequest.headSha,
						baseSha: pullRequest.baseSha,
						draft: pullRequest.draft,
						providerUpdatedAt: pullRequest.updatedAt,
						providerClosedAt: pullRequest.closedAt,
						providerMergedAt: pullRequest.mergedAt,
						lastSyncedAt: new Date(),
						// The checks cursor records when the head this mapping points at
						// was reconciled, so a new head has never been reconciled at all.
						// Carrying the old commit's timestamp over would sort the moved
						// pull request to the back of the rotation and leave the new head
						// showing the previous one's results until its turn came around.
						checksSyncedAt: sql`case when ${gitHubPullRequestMappings.headSha} = ${pullRequest.headSha} then ${gitHubPullRequestMappings.checksSyncedAt} else null end`,
					},
				})

			await this.createGitHubEvent(transaction, {
				pullRequestId,
				type: 'opened',
				actorId: authorActorId,
				externalKey: `${pullRequest.nodeId}:opened`,
				createdAt: pullRequest.createdAt,
			})

			if (
				pullRequest.state === 'merged' &&
				mergedByActorId &&
				pullRequest.mergedAt
			)
				await this.createGitHubEvent(transaction, {
					pullRequestId,
					type: 'merged',
					actorId: mergedByActorId,
					externalKey: `${pullRequest.nodeId}:merged`,
					createdAt: pullRequest.mergedAt,
				})

			for (const event of pendingEvents) {
				const type = toPullRequestEventType(event.action, pullRequest.state)
				if (!(type && event.actorId)) continue

				await this.createGitHubEvent(transaction, {
					pullRequestId,
					type,
					actorId: event.actorId,
					deliveryId: event.deliveryId,
					externalKey: event.deliveryId,
					createdAt: event.receivedAt,
				})
			}
		})
	}

	async edit({
		actorUserId,
		body,
		expectedState,
		pullRequestId,
		repositoryId,
		title,
	}: EditParams): Promise<PullRequest | undefined> {
		if (title === undefined && body === undefined) return undefined

		return await this.db.transaction(async tx => {
			const [pullRequest] = await tx
				.update(pullRequests)
				.set({ title, body })
				.where(
					and(
						eq(pullRequests.id, pullRequestId),
						eq(pullRequests.repositoryId, repositoryId),
						eq(pullRequests.state, expectedState),
						ne(pullRequests.state, 'merged')
					)
				)
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return undefined

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId,
				type: 'edited',
			})

			return pullRequest
		})
	}

	async close(params: CloseParams): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			const lockedPullRequest = await this.lockPullRequest(tx, params)

			if (lockedPullRequest?.state !== 'open') return undefined

			const mergeIntent = await this.findMergeIntent(tx, params.pullRequestId)
			if (mergeIntent && mergeIntent.startedAt > params.staleBefore)
				return undefined

			if (mergeIntent)
				await tx
					.delete(pullRequestMergeIntents)
					.where(
						eq(pullRequestMergeIntents.pullRequestId, params.pullRequestId)
					)

			const [pullRequest] = await tx
				.update(pullRequests)
				.set({ state: 'closed', closedAt: params.changedAt })
				.where(
					and(
						eq(pullRequests.id, params.pullRequestId),
						eq(pullRequests.repositoryId, params.repositoryId),
						eq(pullRequests.state, 'open')
					)
				)
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return undefined

			await this.createEvent(tx, {
				pullRequestId: params.pullRequestId,
				actorUserId: params.actorUserId,
				type: 'closed',
			})
			// A queue entry outlives nothing: the pull request it was waiting to
			// merge is closed in this same transaction, so the entry cannot be left
			// behind for the worker to pick up and refuse.
			await removeActiveMergeQueueEntry(tx, {
				actorUserId: params.actorUserId,
				pullRequestId: params.pullRequestId,
				reason: 'closed',
			})

			return pullRequest
		})
	}

	async reopen(params: LifecycleParams): Promise<PullRequest | undefined> {
		return await this.updateLifecycle(params, {
			expectedState: 'closed',
			nextState: 'open',
			type: 'reopened',
			closedAt: null,
		})
	}

	async claimMerge({
		actorUserId,
		attemptId,
		bypass,
		pullRequestId,
		repositoryId,
		staleBefore,
		startedAt,
	}: ClaimMergeParams): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			const lockedPullRequest = await this.lockPullRequest(tx, {
				pullRequestId,
				repositoryId,
			})

			if (lockedPullRequest?.state !== 'open') return undefined
			const mergeIntent = await this.findMergeIntent(tx, pullRequestId)
			if (mergeIntent && mergeIntent.startedAt > staleBefore) return undefined

			// Taking over a lease that aged out never erases what the abandoned
			// attempt was allowed to waive: if this one carries no bypass of its own,
			// the earlier context stays on the row, so a merge that a crashed attempt
			// had already been cleared to make is still recorded as bypassed when it
			// completes.
			if (mergeIntent)
				await tx
					.update(pullRequestMergeIntents)
					.set({
						attemptId,
						actorUserId,
						startedAt,
						bypass: bypass ?? mergeIntent.bypass,
					})
					.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))
			else
				await tx.insert(pullRequestMergeIntents).values({
					pullRequestId,
					attemptId,
					actorUserId,
					bypass,
					startedAt,
				})

			return lockedPullRequest
		})
	}

	/**
	 * Audits a merge that was refused. Written for attempts only — a requirements
	 * read is a question, and the timeline records decisions, not questions.
	 */
	async recordMergeBlocked({
		actorUserId,
		payload,
		pullRequestId,
	}: RecordMergeBlockedParams): Promise<void> {
		await this.createEvent(this.db, {
			pullRequestId,
			actorUserId,
			type: 'merge_blocked',
			payload,
		})
	}

	async completeMerge({
		actorUserId,
		attemptId,
		changedAt,
		mergeCommitSha,
		pullRequestId,
		queueEntryId,
		repositoryId,
	}: CompleteMergeParams): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			const lockedPullRequest = await this.lockPullRequest(tx, {
				pullRequestId,
				repositoryId,
			})
			const mergeIntent = await this.findMergeIntent(tx, pullRequestId)

			if (
				lockedPullRequest?.state !== 'open' ||
				mergeIntent?.attemptId !== attemptId
			)
				return undefined

			const [pullRequest] = await tx
				.update(pullRequests)
				.set({
					state: 'merged',
					mergeCommitSha,
					mergeActorUserId: actorUserId,
					mergedAt: changedAt,
					closedAt: changedAt,
				})
				.where(
					and(
						eq(pullRequests.id, pullRequestId),
						eq(pullRequests.repositoryId, repositoryId),
						eq(pullRequests.state, 'open')
					)
				)
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return undefined

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId,
				type: 'merged',
			})

			// The bypass audit is written from the claimed intent rather than from the
			// request, and in the same transaction as the merge it excuses, so the two
			// rows can only ever appear together. If the process dies between Git and
			// this point the intent row survives with the waiver on it, which is what
			// a later attempt or an operator reads to see that policy was waived —
			// reconciling such an abandoned merge automatically is still to be built.
			if (mergeIntent.bypass)
				await this.createEvent(tx, {
					pullRequestId,
					actorUserId,
					type: 'merge_bypassed',
					payload: mergeIntent.bypass,
				})

			// The queue entry this run was merging finishes with the merge itself, so
			// the two can never disagree about whether it happened. An entry left
			// over from any other path is dropped right behind it: a merged pull
			// request has nothing left to wait for.
			if (queueEntryId) await completeMergeQueueEntry(tx, queueEntryId)

			await removeActiveMergeQueueEntry(tx, {
				actorUserId,
				pullRequestId,
				reason: 'merged',
			})

			await tx
				.delete(pullRequestMergeIntents)
				.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))

			return pullRequest
		})
	}

	/**
	 * Records where a push moved a source branch, on every open native pull
	 * request that branch backs — a branch may back several when their targets
	 * differ. Whether a pull request is open is judged now rather than at push
	 * time, which is why one created after the push is left alone: its opening
	 * already accounts for the commits this delivery describes.
	 *
	 * Deliveries are retried until the API acknowledges one, so every event
	 * carries the key of the delivery that produced it and a repeat inserts
	 * nothing.
	 *
	 * Every pull request the whole delivery touches is locked by one query in
	 * id order. Locking per branch instead would let two deliveries that name
	 * the same branches in opposite orders each hold what the other is waiting
	 * for, and PostgreSQL would abort one of them as a deadlock.
	 */
	async createPushEvents({
		actorUserId,
		occurredAt,
		operationId,
		repositoryId,
		updates,
	}: CreatePushEventsParams): Promise<number> {
		return await this.db.transaction(async tx => {
			const openPullRequests = await tx
				.select({
					id: pullRequests.id,
					sourceBranch: pullRequests.sourceBranch,
				})
				.from(pullRequests)
				.where(
					and(
						eq(pullRequests.repositoryId, repositoryId),
						inArray(
							pullRequests.sourceBranch,
							updates.map(update => update.sourceBranch)
						),
						eq(pullRequests.provider, 'tessera'),
						eq(pullRequests.state, 'open'),
						lte(pullRequests.createdAt, occurredAt)
					)
				)
				.orderBy(asc(pullRequests.id))
				.for('update')

			let createdEvents = 0

			for (const update of updates) {
				const moved = openPullRequests.filter(
					pullRequest => pullRequest.sourceBranch === update.sourceBranch
				)

				if (moved.length === 0) continue

				const events = await tx
					.insert(pullRequestEvents)
					.values(
						moved.map(({ id }) => ({
							pullRequestId: id,
							actorUserId,
							type: update.type,
							payload: {
								ref: update.ref,
								oldSha: update.oldSha,
								newSha: update.newSha,
							},
							idempotencyKey: `git-push:${operationId}:${update.ref}`,
							createdAt: occurredAt,
						}))
					)
					// Narrowed to the delivery-key index: a conflict on anything
					// else is a real failure, not a redelivery.
					.onConflictDoNothing({
						target: [
							pullRequestEvents.pullRequestId,
							pullRequestEvents.idempotencyKey,
						],
						where: sql`${pullRequestEvents.idempotencyKey} is not null`,
					})
					.returning({ id: pullRequestEvents.id })

				createdEvents += events.length
			}

			return createdEvents
		})
	}

	async releaseMerge({
		attemptId,
		pullRequestId,
	}: ReleaseMergeParams): Promise<void> {
		await this.db
			.delete(pullRequestMergeIntents)
			.where(
				and(
					eq(pullRequestMergeIntents.pullRequestId, pullRequestId),
					eq(pullRequestMergeIntents.attemptId, attemptId)
				)
			)
	}

	private async updateLifecycle(
		params: LifecycleParams,
		transition: {
			expectedState: PullRequest['state']
			nextState: PullRequest['state']
			type: PullRequestEvent['type']
			closedAt: Date | null
		}
	): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			const [pullRequest] = await tx
				.update(pullRequests)
				.set({
					state: transition.nextState,
					closedAt: transition.closedAt,
				})
				.where(
					and(
						eq(pullRequests.id, params.pullRequestId),
						eq(pullRequests.repositoryId, params.repositoryId),
						eq(pullRequests.state, transition.expectedState)
					)
				)
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return undefined

			await this.createEvent(tx, {
				pullRequestId: params.pullRequestId,
				actorUserId: params.actorUserId,
				type: transition.type,
			})

			return pullRequest
		})
	}

	private async createEvent(
		db: PullRequestDatabase,
		params: {
			pullRequestId: PullRequestId
			actorUserId: UserId
			type: PullRequestEvent['type']
			payload?: PullRequestEventPayload
		}
	) {
		await db.insert(pullRequestEvents).values(params)
	}

	private async lockPullRequest(
		tx: DrizzleTransaction,
		{
			pullRequestId,
			repositoryId,
		}: Omit<PullRequestMutationParams, 'actorUserId'>
	) {
		const [pullRequest] = await tx
			.select(PULL_REQUEST_COLUMNS)
			.from(pullRequests)
			.where(
				and(
					eq(pullRequests.id, pullRequestId),
					eq(pullRequests.repositoryId, repositoryId)
				)
			)
			.for('update')

		return pullRequest
	}

	private async findMergeIntent(
		tx: DrizzleTransaction,
		pullRequestId: PullRequestId
	) {
		const [mergeIntent] = await tx
			.select({
				attemptId: pullRequestMergeIntents.attemptId,
				bypass: pullRequestMergeIntents.bypass,
				startedAt: pullRequestMergeIntents.startedAt,
			})
			.from(pullRequestMergeIntents)
			.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))
			.limit(1)

		return mergeIntent
	}

	private async createGitHubPullRequest(
		transaction: DrizzleTransaction,
		{
			pullRequest,
			repositoryId,
		}: Pick<ReconcileGitHubPullRequestParams, 'pullRequest' | 'repositoryId'>
	): Promise<PullRequestId> {
		const number = await this.allocatePullRequestNumber(
			transaction,
			repositoryId
		)
		if (!number)
			throw new Error('failed to allocate synchronized pull request number')

		const [createdPullRequest] = await transaction
			.insert(pullRequests)
			.values({
				repositoryId,
				provider: 'github',
				number,
				sourceBranch: pullRequest.sourceBranch,
				targetBranch: pullRequest.targetBranch,
				openingBaseSha: pullRequest.baseSha,
				openingHeadSha: pullRequest.headSha,
				title: pullRequest.title,
				body: pullRequest.body,
				state: pullRequest.state,
				mergeCommitSha: pullRequest.mergeCommitSha,
				createdAt: pullRequest.createdAt,
				updatedAt: pullRequest.updatedAt,
				closedAt: pullRequest.closedAt,
				mergedAt: pullRequest.mergedAt,
			})
			.returning({ id: pullRequests.id })

		if (!createdPullRequest)
			throw new Error('failed to create synchronized GitHub pull request')

		return createdPullRequest.id
	}

	private async updateGitHubPullRequest(
		transaction: DrizzleTransaction,
		{
			pullRequest,
			pullRequestId,
		}: {
			pullRequest: GitHubSyncPullRequest
			pullRequestId: PullRequestId
		}
	): Promise<PullRequestId> {
		const [updatedPullRequest] = await transaction
			.update(pullRequests)
			.set({
				sourceBranch: pullRequest.sourceBranch,
				targetBranch: pullRequest.targetBranch,
				title: pullRequest.title,
				body: pullRequest.body,
				state: pullRequest.state,
				mergeCommitSha: pullRequest.mergeCommitSha,
				updatedAt: pullRequest.updatedAt,
				closedAt: pullRequest.closedAt,
				mergedAt: pullRequest.mergedAt,
			})
			.where(
				and(
					eq(pullRequests.id, pullRequestId),
					eq(pullRequests.provider, 'github')
				)
			)
			.returning({ id: pullRequests.id })

		if (!updatedPullRequest)
			throw new Error('failed to update synchronized GitHub pull request')

		return updatedPullRequest.id
	}

	private async allocatePullRequestNumber(
		transaction: PullRequestDatabase,
		repositoryId: RepositoryId
	): Promise<number | undefined> {
		await transaction
			.insert(repositoryPullRequestCounters)
			.values({ repositoryId })
			.onConflictDoNothing()

		const [counter] = await transaction
			.update(repositoryPullRequestCounters)
			.set({
				nextNumber: sql`${repositoryPullRequestCounters.nextNumber} + 1`,
			})
			.where(eq(repositoryPullRequestCounters.repositoryId, repositoryId))
			.returning({
				nextNumber: repositoryPullRequestCounters.nextNumber,
			})

		return counter ? counter.nextNumber - 1 : undefined
	}

	private async createGitHubEvent(
		transaction: DrizzleTransaction,
		{
			actorId,
			createdAt,
			deliveryId,
			externalKey,
			pullRequestId,
			type,
		}: {
			actorId: GitHubActorId
			createdAt: Date
			deliveryId?: GitHubWebhookDeliveryId
			externalKey: string
			pullRequestId: PullRequestId
			type: PullRequestEvent['type']
		}
	): Promise<void> {
		const existingMapping =
			await transaction.query.gitHubPullRequestEventMappings.findFirst({
				where: eq(gitHubPullRequestEventMappings.externalKey, externalKey),
				columns: { id: true },
			})

		if (existingMapping) return

		const [event] = await transaction
			.insert(pullRequestEvents)
			.values({
				pullRequestId,
				provider: 'github',
				type,
				createdAt,
			})
			.returning({ id: pullRequestEvents.id })

		if (!event) throw new Error('failed to create synchronized GitHub event')

		await transaction.insert(gitHubPullRequestEventMappings).values({
			pullRequestEventId: event.id,
			externalKey,
			actorId,
			deliveryId,
			createdAt,
		})
	}
}

function toPullRequestReadModel(
	pullRequest: PullRequestReadRow
): PullRequestReadModel {
	return {
		id: pullRequest.id,
		repositoryId: pullRequest.repositoryId,
		provider: pullRequest.provider,
		number: pullRequest.number,
		authorUserId: pullRequest.authorUserId,
		authorUsername: pullRequest.authorUsername,
		authorActorNodeId: pullRequest.authorActorNodeId ?? undefined,
		sourceBranch: pullRequest.sourceBranch,
		targetBranch: pullRequest.targetBranch,
		openingBaseSha: pullRequest.openingBaseSha,
		openingHeadSha: pullRequest.openingHeadSha,
		title: pullRequest.title,
		body: pullRequest.body,
		state: pullRequest.state,
		mergeCommitSha: pullRequest.mergeCommitSha,
		mergeActorUserId: pullRequest.mergeActorUserId,
		createdAt: pullRequest.createdAt,
		updatedAt: pullRequest.updatedAt,
		closedAt: pullRequest.closedAt,
		mergedAt: pullRequest.mergedAt,
		github:
			pullRequest.githubNodeId &&
			pullRequest.githubHtmlUrl &&
			pullRequest.githubDraft !== null &&
			pullRequest.githubHeadSha &&
			pullRequest.githubBaseSha
				? {
						nodeId: pullRequest.githubNodeId,
						htmlUrl: pullRequest.githubHtmlUrl,
						draft: pullRequest.githubDraft,
						headSha: pullRequest.githubHeadSha,
						baseSha: pullRequest.githubBaseSha,
						mergedByUsername: pullRequest.githubMergedByUsername ?? undefined,
					}
				: undefined,
	}
}

function toPullRequestEventType(
	action: string,
	state: PullRequest['state']
): PullRequestEvent['type'] | undefined {
	switch (action) {
		case 'opened':
			return undefined
		case 'edited':
			return 'edited'
		case 'closed':
			return state === 'merged' ? undefined : 'closed'
		case 'reopened':
			return 'reopened'
		case 'synchronize':
			return 'synchronized'
		case 'converted_to_draft':
			return 'converted_to_draft'
		case 'ready_for_review':
			return 'ready_for_review'
		case 'assigned':
			return 'assigned'
		case 'review_requested':
			return 'review_requested'
		case 'labeled':
			return 'labeled'
		default:
			return undefined
	}
}

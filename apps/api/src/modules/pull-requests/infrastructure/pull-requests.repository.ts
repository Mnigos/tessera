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
	ne,
	type PullRequest,
	type PullRequestEvent,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositoryPullRequestCounters,
	sql,
	user,
} from '@repo/db'
import type { PullRequestId, RepositoryId, UserId } from '@repo/domain'
import { alias } from 'drizzle-orm/pg-core'

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
	staleBefore: Date
	startedAt: Date
}

interface CompleteMergeParams extends LifecycleParams {
	attemptId: string
	mergeCommitSha: string
}

interface ReleaseMergeParams extends PullRequestMutationParams {
	attemptId: string
}

type PullRequestDatabase = Database | DrizzleTransaction

export interface PullRequestReadModel extends PullRequest {
	authorUsername?: string
	github?: {
		nodeId: string
		htmlUrl: string
		draft: boolean
		headSha: string
		baseSha: string
		mergedByUsername?: string
	}
}

export interface PullRequestEventReadModel extends PullRequestEvent {
	actorUsername?: string
}

interface PullRequestReadRow extends PullRequest {
	authorUsername: string
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
			.orderBy(asc(pullRequestEvents.createdAt))
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

			if (mergeIntent)
				await tx
					.update(pullRequestMergeIntents)
					.set({ attemptId, actorUserId, startedAt })
					.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))
			else
				await tx.insert(pullRequestMergeIntents).values({
					pullRequestId,
					attemptId,
					actorUserId,
					startedAt,
				})

			return lockedPullRequest
		})
	}

	async completeMerge({
		actorUserId,
		attemptId,
		changedAt,
		mergeCommitSha,
		pullRequestId,
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
			await tx
				.delete(pullRequestMergeIntents)
				.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))

			return pullRequest
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

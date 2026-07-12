import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	type DrizzleTransaction,
	desc,
	eq,
	ne,
	type PullRequest,
	type PullRequestEvent,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositoryPullRequestCounters,
	sql,
} from '@repo/db'
import type { PullRequestId, RepositoryId, UserId } from '@repo/domain'

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

const PULL_REQUEST_COLUMNS = {
	id: pullRequests.id,
	repositoryId: pullRequests.repositoryId,
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

@Injectable()
export class PullRequestsRepository {
	constructor(private readonly db: Database) {}

	async create(params: CreateParams): Promise<PullRequest | undefined> {
		return await this.db.transaction(async tx => {
			await tx
				.insert(repositoryPullRequestCounters)
				.values({ repositoryId: params.repositoryId })
				.onConflictDoNothing()

			const [counter] = await tx
				.update(repositoryPullRequestCounters)
				.set({
					nextNumber: sql`${repositoryPullRequestCounters.nextNumber} + 1`,
				})
				.where(
					eq(repositoryPullRequestCounters.repositoryId, params.repositoryId)
				)
				.returning({
					nextNumber: repositoryPullRequestCounters.nextNumber,
				})

			if (!counter) return undefined

			const [pullRequest] = await tx
				.insert(pullRequests)
				.values({
					repositoryId: params.repositoryId,
					number: counter.nextNumber - 1,
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

	async list({ repositoryId, state }: ListParams): Promise<PullRequest[]> {
		const conditions = [eq(pullRequests.repositoryId, repositoryId)]

		if (state) conditions.push(eq(pullRequests.state, state))

		return await this.db
			.select(PULL_REQUEST_COLUMNS)
			.from(pullRequests)
			.where(and(...conditions))
			.orderBy(desc(pullRequests.number))
	}

	async find({
		number,
		repositoryId,
	}: PullRequestNumberParams): Promise<PullRequest | undefined> {
		const [pullRequest] = await this.db
			.select(PULL_REQUEST_COLUMNS)
			.from(pullRequests)
			.where(
				and(
					eq(pullRequests.repositoryId, repositoryId),
					eq(pullRequests.number, number)
				)
			)
			.limit(1)

		return pullRequest
	}

	async listEvents({
		pullRequestId,
	}: Pick<PullRequestMutationParams, 'pullRequestId'>): Promise<
		PullRequestEvent[]
	> {
		return await this.db
			.select({
				id: pullRequestEvents.id,
				pullRequestId: pullRequestEvents.pullRequestId,
				actorUserId: pullRequestEvents.actorUserId,
				type: pullRequestEvents.type,
				createdAt: pullRequestEvents.createdAt,
			})
			.from(pullRequestEvents)
			.where(eq(pullRequestEvents.pullRequestId, pullRequestId))
			.orderBy(asc(pullRequestEvents.createdAt))
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
}

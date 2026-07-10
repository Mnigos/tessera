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

	async close(params: LifecycleParams): Promise<PullRequest | undefined> {
		return await this.updateLifecycle(params, {
			expectedState: 'open',
			nextState: 'closed',
			type: 'closed',
			closedAt: params.changedAt,
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
}

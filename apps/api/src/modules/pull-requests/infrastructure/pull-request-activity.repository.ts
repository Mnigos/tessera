import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	checkObservations,
	checks,
	count,
	desc,
	eq,
	gitHubPullRequestMappings,
	inArray,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviews,
	pullRequestThreads,
	repositoryExternalSources,
	sql,
} from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'

export interface PullRequestThreadsActivity {
	threadsUpdatedAt?: Date
	commentCount: number
	unresolvedThreadCount: number
}

export interface PullRequestMirrorActivity {
	requestedSyncVersion: number
	projectedSyncVersion: number
	lastSyncedAt?: Date
}

/** One indexed aggregate row per moving part, and never a call to Git storage. */
@Injectable()
export class PullRequestActivityRepository {
	constructor(private readonly db: Database) {}

	// Drafts are left out: a viewer's own unsent comment is not activity.
	async readThreadsActivity(
		pullRequestId: PullRequestId
	): Promise<PullRequestThreadsActivity> {
		const [row] = await this.db
			.select({
				threadsUpdatedAt:
					sql<Date | null>`greatest(max(${pullRequestThreads.updatedAt}), max(${pullRequestComments.updatedAt}))`.mapWith(
						pullRequestThreads.updatedAt
					),
				commentCount: count(pullRequestComments.id),
				unresolvedThreadCount:
					sql<number>`count(distinct ${pullRequestThreads.id}) filter (where ${pullRequestThreads.resolvedAt} is null and ${pullRequestComments.id} is not null)`.mapWith(
						Number
					),
			})
			.from(pullRequestThreads)
			.leftJoin(
				pullRequestComments,
				and(
					eq(pullRequestComments.threadId, pullRequestThreads.id),
					eq(pullRequestComments.state, 'published')
				)
			)
			.where(eq(pullRequestThreads.pullRequestId, pullRequestId))

		return {
			threadsUpdatedAt: row?.threadsUpdatedAt ?? undefined,
			commentCount: row?.commentCount ?? 0,
			unresolvedThreadCount: row?.unresolvedThreadCount ?? 0,
		}
	}

	async readReviewsUpdatedAt(
		pullRequestId: PullRequestId
	): Promise<Date | undefined> {
		const [row] = await this.db
			.select({
				updatedAt:
					sql<Date | null>`max(${pullRequestReviews.updatedAt})`.mapWith(
						pullRequestReviews.updatedAt
					),
			})
			.from(pullRequestReviews)
			.where(eq(pullRequestReviews.pullRequestId, pullRequestId))

		return row?.updatedAt ?? undefined
	}

	async readEventsCreatedAt(
		pullRequestId: PullRequestId
	): Promise<Date | undefined> {
		const [row] = await this.db
			.select({
				createdAt:
					sql<Date | null>`max(${pullRequestEvents.createdAt})`.mapWith(
						pullRequestEvents.createdAt
					),
			})
			.from(pullRequestEvents)
			.where(eq(pullRequestEvents.pullRequestId, pullRequestId))

		return row?.createdAt ?? undefined
	}

	// Where the last acknowledged push left the branch, so no ref lookup is needed.
	async findPushedHeadSha(
		pullRequestId: PullRequestId
	): Promise<string | undefined> {
		const [row] = await this.db
			.select({
				newSha: sql<string | null>`${pullRequestEvents.payload}->>'newSha'`,
			})
			.from(pullRequestEvents)
			.where(
				and(
					eq(pullRequestEvents.pullRequestId, pullRequestId),
					inArray(pullRequestEvents.type, ['head_updated', 'force_pushed'])
				)
			)
			.orderBy(desc(pullRequestEvents.createdAt))
			.limit(1)

		return row?.newSha ?? undefined
	}

	async readChecksUpdatedAt({
		headSha,
		repositoryId,
	}: {
		headSha: string
		repositoryId: RepositoryId
	}): Promise<Date | undefined> {
		const [row] = await this.db
			.select({
				observedAt:
					sql<Date | null>`max(${checkObservations.observedAt})`.mapWith(
						checkObservations.observedAt
					),
			})
			.from(checkObservations)
			.innerJoin(checks, eq(checks.id, checkObservations.checkId))
			.where(
				and(eq(checks.repositoryId, repositoryId), eq(checks.sha, headSha))
			)

		return row?.observedAt ?? undefined
	}

	// Only while GitHub still feeds the repository; a cut-over one cannot be behind.
	async findMirrorActivity(
		pullRequestId: PullRequestId
	): Promise<PullRequestMirrorActivity | undefined> {
		const [row] = await this.db
			.select({
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
				projectedSyncVersion: repositoryExternalSources.completedSyncVersion,
				lastSyncedAt: gitHubPullRequestMappings.lastSyncedAt,
			})
			.from(gitHubPullRequestMappings)
			.innerJoin(
				repositoryExternalSources,
				eq(
					repositoryExternalSources.repositoryId,
					gitHubPullRequestMappings.repositoryId
				)
			)
			.where(
				and(
					eq(gitHubPullRequestMappings.pullRequestId, pullRequestId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
			.limit(1)

		return row ?? undefined
	}
}

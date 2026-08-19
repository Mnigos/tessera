import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	asc,
	count,
	eq,
	isNull,
	or,
	pullRequestFileViews,
	sql,
} from '@repo/db'
import type { PullRequestId, UserId } from '@repo/domain'

interface PullRequestFileViewsParams {
	pullRequestId: PullRequestId
	userId: UserId
}

interface FileViewParams extends PullRequestFileViewsParams {
	path: string
	baseBlobId?: string
	headBlobId?: string
}

interface MarkFileViewedParams extends FileViewParams {
	headSha: string
	limit: number
}

/** The diff identity a tick was made against, which outlives the head it was made on. */
export interface PullRequestFileViewRow {
	path: string
	baseBlobId: string | null
	headBlobId: string | null
	headSha: string
}

export type PullRequestFileViewResult =
	| 'marked'
	| 'already_viewed'
	| 'limit_reached'

@Injectable()
export class PullRequestFileViewsRepository {
	constructor(private readonly db: Database) {}

	async listViews({
		pullRequestId,
		userId,
	}: PullRequestFileViewsParams): Promise<PullRequestFileViewRow[]> {
		return await this.db
			.select({
				path: pullRequestFileViews.path,
				baseBlobId: pullRequestFileViews.baseBlobId,
				headBlobId: pullRequestFileViews.headBlobId,
				headSha: pullRequestFileViews.headSha,
			})
			.from(pullRequestFileViews)
			.where(this.scope({ pullRequestId, userId }))
			.orderBy(asc(pullRequestFileViews.path))
	}

	// The lock keeps two ticks racing at the limit from both counting below it and inserting.
	async markViewed({
		baseBlobId,
		headBlobId,
		headSha,
		limit,
		path,
		pullRequestId,
		userId,
	}: MarkFileViewedParams): Promise<PullRequestFileViewResult> {
		const scope = this.scope({ pullRequestId, userId })
		const identity = {
			baseBlobId: baseBlobId ?? null,
			headBlobId: headBlobId ?? null,
			headSha,
			viewedAt: new Date(),
		}

		return await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`pull_request_file_views:${userId}:${pullRequestId}`}, 0))`
			)

			const [existing] = await transaction
				.select({ path: pullRequestFileViews.path })
				.from(pullRequestFileViews)
				.where(and(scope, eq(pullRequestFileViews.path, path)))
				.limit(1)

			// A re-tick of a file that has since moved carries its new blob pair.
			if (existing) {
				await transaction
					.update(pullRequestFileViews)
					.set(identity)
					.where(and(scope, eq(pullRequestFileViews.path, path)))

				return 'already_viewed'
			}

			const [viewed] = await transaction
				.select({ total: count() })
				.from(pullRequestFileViews)
				.where(scope)

			if ((viewed?.total ?? 0) >= limit) return 'limit_reached'

			await transaction
				.insert(pullRequestFileViews)
				.values({ pullRequestId, userId, path, ...identity })

			return 'marked'
		})
	}

	// An untick has to reach the row a rename left behind, or the file reads viewed again.
	async clearViewed({
		baseBlobId,
		headBlobId,
		path,
		pullRequestId,
		userId,
	}: FileViewParams): Promise<void> {
		const byPath = eq(pullRequestFileViews.path, path)
		const byBlobPair =
			(baseBlobId || headBlobId) &&
			and(
				baseBlobId
					? eq(pullRequestFileViews.baseBlobId, baseBlobId)
					: isNull(pullRequestFileViews.baseBlobId),
				headBlobId
					? eq(pullRequestFileViews.headBlobId, headBlobId)
					: isNull(pullRequestFileViews.headBlobId)
			)

		await this.db
			.delete(pullRequestFileViews)
			.where(
				and(
					this.scope({ pullRequestId, userId }),
					byBlobPair ? or(byPath, byBlobPair) : byPath
				)
			)
	}

	private scope({ pullRequestId, userId }: PullRequestFileViewsParams) {
		return and(
			eq(pullRequestFileViews.pullRequestId, pullRequestId),
			eq(pullRequestFileViews.userId, userId)
		)
	}
}

import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import { and, asc, count, eq, pullRequestFileViews, sql } from '@repo/db'
import type { PullRequestId, UserId } from '@repo/domain'

interface PullRequestFileViewsParams {
	pullRequestId: PullRequestId
	userId: UserId
	headSha: string
}

interface FileViewParams extends PullRequestFileViewsParams {
	path: string
}

interface MarkFileViewedParams extends FileViewParams {
	limit: number
}

export type PullRequestFileViewResult =
	| 'marked'
	| 'already_viewed'
	| 'limit_reached'

@Injectable()
export class PullRequestFileViewsRepository {
	constructor(private readonly db: Database) {}

	async listPaths({
		headSha,
		pullRequestId,
		userId,
	}: PullRequestFileViewsParams): Promise<string[]> {
		const rows = await this.db
			.select({ path: pullRequestFileViews.path })
			.from(pullRequestFileViews)
			.where(this.scope({ headSha, pullRequestId, userId }))
			.orderBy(asc(pullRequestFileViews.path))

		return rows.map(row => row.path)
	}

	// The lock keeps two ticks racing at the limit from both counting below it and inserting.
	async markViewed({
		headSha,
		limit,
		path,
		pullRequestId,
		userId,
	}: MarkFileViewedParams): Promise<PullRequestFileViewResult> {
		const scope = this.scope({ headSha, pullRequestId, userId })

		return await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`pull_request_file_views:${userId}:${pullRequestId}:${headSha}`}, 0))`
			)

			const [existing] = await transaction
				.select({ path: pullRequestFileViews.path })
				.from(pullRequestFileViews)
				.where(and(scope, eq(pullRequestFileViews.path, path)))
				.limit(1)

			if (existing) return 'already_viewed'

			const [viewed] = await transaction
				.select({ total: count() })
				.from(pullRequestFileViews)
				.where(scope)

			if ((viewed?.total ?? 0) >= limit) return 'limit_reached'

			await transaction
				.insert(pullRequestFileViews)
				.values({ pullRequestId, userId, headSha, path })

			return 'marked'
		})
	}

	async clearViewed({
		headSha,
		path,
		pullRequestId,
		userId,
	}: FileViewParams): Promise<void> {
		await this.db
			.delete(pullRequestFileViews)
			.where(
				and(
					this.scope({ headSha, pullRequestId, userId }),
					eq(pullRequestFileViews.path, path)
				)
			)
	}

	private scope({
		headSha,
		pullRequestId,
		userId,
	}: PullRequestFileViewsParams) {
		return and(
			eq(pullRequestFileViews.pullRequestId, pullRequestId),
			eq(pullRequestFileViews.userId, userId),
			eq(pullRequestFileViews.headSha, headSha)
		)
	}
}

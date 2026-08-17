import { Database } from '@config/database'
import { upsertGitHubActor } from '@modules/github-sync/infrastructure/github-actor.upsert'
import type {
	GitHubSyncIssueComment,
	GitHubSyncPullRequest,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewOutcome,
} from '@modules/github-sync/infrastructure/github-sync.client.types'
import { toTombstonedNodeId } from '@modules/github-sync/infrastructure/github-sync-conversations.repository'
import { Injectable } from '@nestjs/common'
import type { PullRequestThreadAnchor } from '@repo/contracts'
import {
	account,
	and,
	asc,
	count,
	type DrizzleTransaction,
	eq,
	type GitHubActorId,
	type GitHubPullRequestMappingId,
	type GitHubPullRequestThreadMappingId,
	gitHubActors,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	gitHubPullRequestReviewerRequestMappings,
	gitHubPullRequestReviewMappings,
	gitHubPullRequestThreadMappings,
	isNotNull,
	isNull,
	ne,
	type PullRequestEvent,
	type PullRequestEventPayload,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	repositoryExternalSources,
	sql,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'

export interface GitHubPullRequestWriteTarget {
	pullRequestMappingId: GitHubPullRequestMappingId
	externalNodeId: string
	externalNumber: number
}

export interface GitHubCommentWriteTarget {
	kind: 'issue' | 'review'
	externalNumericId: bigint
}

export interface GitHubThreadWriteTarget {
	threadMappingId: GitHubPullRequestThreadMappingId
	externalNodeId: string | null
	rootCommentNumericId: bigint | undefined
}

export interface GitHubUserIdentity {
	actorId: GitHubActorId
	externalNodeId: string
	externalNumericId: bigint | null
	login: string
}

interface EchoParams {
	actorUserId: UserId
	pullRequestId: PullRequestId
	repositoryId: RepositoryId
	target: GitHubPullRequestWriteTarget
}

interface EchoCommentParams extends EchoParams {
	comment: GitHubSyncIssueComment
}

interface EchoReviewCommentParams extends EchoParams {
	anchor: PullRequestThreadAnchor
	comment: GitHubSyncReviewComment
}

interface EchoReplyParams extends EchoParams {
	comment: GitHubSyncReviewComment
	threadId: PullRequestThreadId
	threadMappingId: GitHubPullRequestThreadMappingId
}

interface EchoCommentEditParams extends EchoParams {
	body: string
	commentId: PullRequestCommentId
	updatedAt: Date
}

interface EchoCommentDeletionParams extends EchoParams {
	commentId: PullRequestCommentId
	threadId: PullRequestThreadId
}

interface EchoThreadResolutionParams extends EchoParams {
	resolved: boolean
	threadId: PullRequestThreadId
	threadMappingId: GitHubPullRequestThreadMappingId
	threadNodeId: string
}

interface EchoReviewerRequestParams extends EchoParams {
	reviewer: GitHubUserIdentity
	reviewerUserId: UserId
}

interface EchoReviewParams extends EchoParams {
	headSha: string
	review: GitHubSyncReview & { outcome: GitHubSyncReviewOutcome }
}

interface EchoPullRequestParams {
	mergeCommitSha?: string
	pullRequest: GitHubSyncPullRequest
	pullRequestId: PullRequestId
	repositoryId: RepositoryId
}

@Injectable()
export class GitHubWriteThroughRepository {
	constructor(private readonly db: Database) {}

	async findGitHubAccount({ userId }: { userId: UserId }) {
		return await this.db.query.account.findFirst({
			where: and(eq(account.userId, userId), eq(account.providerId, 'github')),
			columns: { accessToken: true, scope: true, accessTokenExpiresAt: true },
		})
	}

	async findPullRequestTarget({
		pullRequestId,
	}: {
		pullRequestId: PullRequestId
	}): Promise<GitHubPullRequestWriteTarget | undefined> {
		const [target] = await this.db
			.select({
				pullRequestMappingId: gitHubPullRequestMappings.id,
				externalNodeId: gitHubPullRequestMappings.externalNodeId,
				externalNumber: gitHubPullRequestMappings.externalNumber,
			})
			.from(gitHubPullRequestMappings)
			.where(eq(gitHubPullRequestMappings.pullRequestId, pullRequestId))
			.limit(1)

		return target
	}

	async findCommentTarget({
		commentId,
	}: {
		commentId: PullRequestCommentId
	}): Promise<GitHubCommentWriteTarget | undefined> {
		const [target] = await this.db
			.select({
				kind: gitHubPullRequestCommentMappings.kind,
				externalNumericId: gitHubPullRequestCommentMappings.externalNumericId,
			})
			.from(gitHubPullRequestCommentMappings)
			.where(
				eq(gitHubPullRequestCommentMappings.pullRequestCommentId, commentId)
			)
			.limit(1)

		return target
	}

	async findThreadTarget({
		threadId,
	}: {
		threadId: PullRequestThreadId
	}): Promise<GitHubThreadWriteTarget | undefined> {
		const [mapping] = await this.db
			.select({
				threadMappingId: gitHubPullRequestThreadMappings.id,
				externalNodeId: gitHubPullRequestThreadMappings.externalNodeId,
			})
			.from(gitHubPullRequestThreadMappings)
			.where(
				and(
					eq(gitHubPullRequestThreadMappings.pullRequestThreadId, threadId),
					isNull(gitHubPullRequestThreadMappings.deletedAt)
				)
			)
			.limit(1)

		if (!mapping) return undefined

		const [rootComment] = await this.db
			.select({
				externalNumericId: gitHubPullRequestCommentMappings.externalNumericId,
			})
			.from(gitHubPullRequestCommentMappings)
			.where(
				and(
					eq(
						gitHubPullRequestCommentMappings.threadMappingId,
						mapping.threadMappingId
					),
					eq(gitHubPullRequestCommentMappings.kind, 'review'),
					isNull(gitHubPullRequestCommentMappings.parentExternalNumericId),
					isNull(gitHubPullRequestCommentMappings.providerDeletedAt)
				)
			)
			.orderBy(asc(gitHubPullRequestCommentMappings.providerCreatedAt))
			.limit(1)

		return { ...mapping, rootCommentNumericId: rootComment?.externalNumericId }
	}

	async findUserIdentity({
		userId,
	}: {
		userId: UserId
	}): Promise<GitHubUserIdentity | undefined> {
		return await this.findUserIdentityIn(this.db, userId)
	}

	async echoIssueComment({
		comment,
		...params
	}: EchoCommentParams): Promise<PullRequestThreadId> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const [thread] = await transaction
				.insert(pullRequestThreads)
				.values({
					pullRequestId: params.pullRequestId,
					provider: 'github',
					kind: 'top_level',
					createdAt: comment.createdAt,
				})
				.returning({ id: pullRequestThreads.id })

			if (!thread) throw new Error('failed to echo GitHub comment thread')

			const [threadMapping] = await transaction
				.insert(gitHubPullRequestThreadMappings)
				.values({
					pullRequestMappingId: params.target.pullRequestMappingId,
					pullRequestThreadId: thread.id,
					rootCommentNodeId: comment.nodeId,
					lastSeenSyncVersion: syncVersion,
				})
				.returning({ id: gitHubPullRequestThreadMappings.id })

			if (!threadMapping)
				throw new Error('failed to map echoed GitHub comment thread')

			await this.insertComment(transaction, {
				...params,
				authorActorId: await upsertGitHubActor(transaction, comment.author),
				comment,
				kind: 'issue',
				syncVersion,
				threadId: thread.id,
				threadMappingId: threadMapping.id,
			})

			return thread.id
		})
	}

	async echoReviewComment({
		anchor,
		comment,
		...params
	}: EchoReviewCommentParams): Promise<PullRequestThreadId> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const [thread] = await transaction
				.insert(pullRequestThreads)
				.values({
					pullRequestId: params.pullRequestId,
					provider: 'github',
					kind: 'inline',
					...anchor,
					// GitHub may place the comment elsewhere than the client asked.
					path: comment.path,
					side: comment.side ?? anchor.side,
					line: comment.line ?? anchor.line,
					anchorSha: comment.commitId ?? anchor.anchorSha,
					headSha: comment.commitId ?? anchor.headSha,
					createdAt: comment.createdAt,
				})
				.returning({ id: pullRequestThreads.id })

			if (!thread) throw new Error('failed to echo GitHub review thread')

			const [threadMapping] = await transaction
				.insert(gitHubPullRequestThreadMappings)
				.values({
					pullRequestMappingId: params.target.pullRequestMappingId,
					pullRequestThreadId: thread.id,
					rootCommentNodeId: comment.nodeId,
					lastSeenSyncVersion: syncVersion,
				})
				.returning({ id: gitHubPullRequestThreadMappings.id })

			if (!threadMapping)
				throw new Error('failed to map echoed GitHub review thread')

			await this.insertComment(transaction, {
				...params,
				authorActorId: await upsertGitHubActor(transaction, comment.author),
				comment,
				kind: 'review',
				reviewComment: comment,
				syncVersion,
				threadId: thread.id,
				threadMappingId: threadMapping.id,
			})

			return thread.id
		})
	}

	async echoReply({
		comment,
		threadId,
		threadMappingId,
		...params
	}: EchoReplyParams): Promise<void> {
		await this.echo(params, async (transaction, syncVersion) => {
			await this.insertComment(transaction, {
				...params,
				authorActorId: await upsertGitHubActor(transaction, comment.author),
				comment,
				kind: 'review',
				reviewComment: comment,
				syncVersion,
				threadId,
				threadMappingId,
			})
		})
	}

	async echoCommentEdit({
		commentId,
		updatedAt,
		...params
	}: EchoCommentEditParams): Promise<void> {
		await this.echo(params, async (transaction, syncVersion) => {
			await transaction
				.update(pullRequestComments)
				.set({ body: params.body, editedAt: updatedAt })
				.where(eq(pullRequestComments.id, commentId))

			await transaction
				.update(gitHubPullRequestCommentMappings)
				.set({ providerUpdatedAt: updatedAt, lastSeenSyncVersion: syncVersion })
				.where(
					eq(gitHubPullRequestCommentMappings.pullRequestCommentId, commentId)
				)
		})
	}

	async echoCommentDeletion({
		commentId,
		threadId,
		...params
	}: EchoCommentDeletionParams): Promise<{ threadDeleted: boolean }> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const deletedAt = new Date()

			// Tombstoned so a pre-delete snapshot cannot reinsert what it still sees.
			await transaction
				.update(gitHubPullRequestCommentMappings)
				.set({
					pullRequestCommentId: null,
					providerDeletedAt: deletedAt,
					lastSeenSyncVersion: syncVersion,
				})
				.where(
					eq(gitHubPullRequestCommentMappings.pullRequestCommentId, commentId)
				)
			await transaction
				.delete(pullRequestComments)
				.where(eq(pullRequestComments.id, commentId))

			const [remainingComment] = await transaction
				.select({ id: pullRequestComments.id })
				.from(pullRequestComments)
				.where(eq(pullRequestComments.threadId, threadId))
				.limit(1)

			if (remainingComment) return { threadDeleted: false }

			const [threadMapping] = await transaction
				.select({
					id: gitHubPullRequestThreadMappings.id,
					externalNodeId: gitHubPullRequestThreadMappings.externalNodeId,
					rootCommentNodeId: gitHubPullRequestThreadMappings.rootCommentNodeId,
				})
				.from(gitHubPullRequestThreadMappings)
				.where(
					eq(gitHubPullRequestThreadMappings.pullRequestThreadId, threadId)
				)
				.limit(1)

			if (threadMapping)
				await transaction
					.update(gitHubPullRequestThreadMappings)
					.set({
						pullRequestThreadId: null,
						deletedAt,
						externalNodeId: toTombstonedNodeId(
							threadMapping.id,
							threadMapping.externalNodeId
						),
						rootCommentNodeId: toTombstonedNodeId(
							threadMapping.id,
							threadMapping.rootCommentNodeId
						),
						lastSeenSyncVersion: syncVersion,
					})
					.where(eq(gitHubPullRequestThreadMappings.id, threadMapping.id))

			await transaction
				.delete(pullRequestThreads)
				.where(eq(pullRequestThreads.id, threadId))

			return { threadDeleted: true }
		})
	}

	async echoThreadResolution({
		resolved,
		threadId,
		threadMappingId,
		threadNodeId,
		...params
	}: EchoThreadResolutionParams): Promise<void> {
		await this.echo(params, async (transaction, syncVersion) => {
			const resolvedAt = resolved ? new Date() : null
			const identity = await this.findUserIdentityIn(
				transaction,
				params.actorUserId
			)

			const [thread] = await transaction
				.update(pullRequestThreads)
				.set({
					resolvedAt,
					resolvedByUserId: resolved ? params.actorUserId : null,
				})
				.where(eq(pullRequestThreads.id, threadId))
				.returning({
					kind: pullRequestThreads.kind,
					path: pullRequestThreads.path,
				})

			await transaction
				.update(gitHubPullRequestThreadMappings)
				.set({
					providerResolved: resolved,
					providerResolvedAt: resolvedAt,
					resolvedByActorId: resolved ? (identity?.actorId ?? null) : null,
					lastSeenSyncVersion: syncVersion,
				})
				.where(eq(gitHubPullRequestThreadMappings.id, threadMappingId))

			if (!(thread && identity)) return

			const type = resolved ? 'thread_resolved' : 'thread_unresolved'
			const createdAt = resolvedAt ?? new Date()

			await this.insertGitHubEvent(transaction, {
				actorId: identity.actorId,
				createdAt,
				externalKey: `${threadNodeId}:${type}:${createdAt.toISOString()}`,
				payload: {
					threadId,
					threadKind: thread.kind,
					path: thread.path ?? undefined,
				},
				pullRequestId: params.pullRequestId,
				type,
			})
		})
	}

	async echoReviewerRequest({
		reviewer,
		reviewerUserId,
		...params
	}: EchoReviewerRequestParams): Promise<PullRequestReviewerRequestId> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const requester = await this.findUserIdentityIn(
				transaction,
				params.actorUserId
			)
			const [inserted] = await transaction
				.insert(pullRequestReviewerRequests)
				.values({
					pullRequestId: params.pullRequestId,
					provider: 'github',
					reviewerUserId,
					requestedByUserId: params.actorUserId,
				})
				.onConflictDoNothing()
				.returning({ id: pullRequestReviewerRequests.id })
			const request =
				inserted ??
				(await this.findActiveReviewerRequest(transaction, {
					pullRequestId: params.pullRequestId,
					reviewerUserId,
				}))

			if (!request) throw new Error('failed to echo GitHub reviewer request')

			const [{ occurrences } = { occurrences: 0 }] = await transaction
				.select({ occurrences: count() })
				.from(gitHubPullRequestReviewerRequestMappings)
				.where(
					and(
						eq(
							gitHubPullRequestReviewerRequestMappings.pullRequestMappingId,
							params.target.pullRequestMappingId
						),
						eq(gitHubPullRequestReviewerRequestMappings.targetKind, 'user'),
						eq(
							gitHubPullRequestReviewerRequestMappings.targetNodeId,
							reviewer.externalNodeId
						)
					)
				)

			await transaction
				.insert(gitHubPullRequestReviewerRequestMappings)
				.values({
					pullRequestMappingId: params.target.pullRequestMappingId,
					pullRequestReviewerRequestId: request.id,
					externalKey: `${params.target.pullRequestMappingId}:user:${reviewer.externalNodeId}:${occurrences}`,
					targetKind: 'user',
					targetNodeId: reviewer.externalNodeId,
					targetNumericId: reviewer.externalNumericId,
					targetActorId: reviewer.actorId,
					requestedByActorId: requester?.actorId,
					active: true,
					lastSeenSyncVersion: syncVersion,
				})
				.onConflictDoNothing()

			return request.id
		})
	}

	async echoReviewerRequestRemoval({
		reviewerUserId,
		...params
	}: Omit<EchoReviewerRequestParams, 'reviewer'>): Promise<boolean> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const remover = await this.findUserIdentityIn(
				transaction,
				params.actorUserId
			)
			const [request] = await transaction
				.update(pullRequestReviewerRequests)
				.set({ removedAt: new Date(), removedByUserId: params.actorUserId })
				.where(
					and(
						eq(pullRequestReviewerRequests.pullRequestId, params.pullRequestId),
						eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
						isNull(pullRequestReviewerRequests.removedAt),
						isNull(pullRequestReviewerRequests.fulfilledByReviewId)
					)
				)
				.returning({ id: pullRequestReviewerRequests.id })

			if (!request) return false

			await transaction
				.update(gitHubPullRequestReviewerRequestMappings)
				.set({
					active: false,
					removedByActorId: remover?.actorId ?? null,
					lastSeenSyncVersion: syncVersion,
				})
				.where(
					eq(
						gitHubPullRequestReviewerRequestMappings.pullRequestReviewerRequestId,
						request.id
					)
				)

			return true
		})
	}

	async echoReview({
		headSha,
		review,
		...params
	}: EchoReviewParams): Promise<PullRequestReviewId> {
		return await this.echo(params, async (transaction, syncVersion) => {
			const reviewerActorId = await upsertGitHubActor(
				transaction,
				review.reviewer
			)
			const [echoedReview] = await transaction
				.insert(pullRequestReviews)
				.values({
					pullRequestId: params.pullRequestId,
					provider: 'github',
					reviewerUserId: params.actorUserId,
					state: 'submitted',
					outcome: review.outcome,
					headSha: review.commitId ?? headSha,
					body: review.body,
					createdAt: review.submittedAt,
					submittedAt: review.submittedAt,
				})
				.returning({ id: pullRequestReviews.id })

			if (!echoedReview) throw new Error('failed to echo GitHub review')

			await transaction.insert(gitHubPullRequestReviewMappings).values({
				pullRequestMappingId: params.target.pullRequestMappingId,
				pullRequestReviewId: echoedReview.id,
				externalNodeId: review.nodeId,
				externalNumericId: review.numericId,
				reviewerActorId,
				htmlUrl: review.htmlUrl,
				commitId: review.commitId,
				providerSubmittedAt: review.submittedAt,
				lastSeenSyncVersion: syncVersion,
			})

			await transaction
				.update(pullRequestReviewerRequests)
				.set({ fulfilledByReviewId: echoedReview.id })
				.where(
					and(
						eq(pullRequestReviewerRequests.pullRequestId, params.pullRequestId),
						eq(pullRequestReviewerRequests.reviewerUserId, params.actorUserId),
						isNull(pullRequestReviewerRequests.removedAt),
						isNull(pullRequestReviewerRequests.fulfilledByReviewId)
					)
				)

			await this.insertGitHubEvent(transaction, {
				actorId: reviewerActorId,
				createdAt: review.submittedAt,
				externalKey: `${review.nodeId}:review_submitted`,
				payload: {
					reviewId: echoedReview.id,
					outcome: review.outcome,
					headSha: review.commitId ?? headSha,
				},
				pullRequestId: params.pullRequestId,
				type: 'review_submitted',
			})

			return echoedReview.id
		})
	}

	async echoPullRequest({
		mergeCommitSha,
		pullRequest,
		pullRequestId,
		repositoryId,
	}: EchoPullRequestParams): Promise<void> {
		await this.echo(
			{ repositoryId, target: { externalNodeId: pullRequest.nodeId } },
			async transaction => {
				const authorActorId = await upsertGitHubActor(
					transaction,
					pullRequest.author
				)
				const mergedByActorId = pullRequest.mergedBy
					? await upsertGitHubActor(transaction, pullRequest.mergedBy)
					: undefined

				await transaction
					.update(pullRequests)
					.set({
						targetBranch: pullRequest.targetBranch,
						title: pullRequest.title,
						body: pullRequest.body,
						state: pullRequest.state,
						mergeCommitSha:
							mergeCommitSha ?? pullRequest.mergeCommitSha ?? null,
						updatedAt: pullRequest.updatedAt,
						closedAt: pullRequest.closedAt ?? null,
						mergedAt: pullRequest.mergedAt ?? null,
					})
					.where(eq(pullRequests.id, pullRequestId))

				await transaction
					.update(gitHubPullRequestMappings)
					.set({
						externalNumber: pullRequest.number,
						htmlUrl: pullRequest.htmlUrl,
						authorActorId,
						mergedByActorId: mergedByActorId ?? null,
						headSha: pullRequest.headSha,
						baseSha: pullRequest.baseSha,
						draft: pullRequest.draft,
						providerUpdatedAt: pullRequest.updatedAt,
						providerClosedAt: pullRequest.closedAt ?? null,
						providerMergedAt: pullRequest.mergedAt ?? null,
						lastSyncedAt: new Date(),
					})
					.where(
						eq(gitHubPullRequestMappings.externalNodeId, pullRequest.nodeId)
					)

				// Only `merged` is echoed: other events are keyed by delivery id.
				if (!(pullRequest.mergedAt && mergedByActorId)) return

				await this.insertGitHubEvent(transaction, {
					actorId: mergedByActorId,
					createdAt: pullRequest.mergedAt,
					externalKey: `${pullRequest.nodeId}:merged`,
					pullRequestId,
					type: 'merged',
				})
			}
		)
	}

	private async insertComment(
		transaction: DrizzleTransaction,
		{
			authorActorId,
			comment,
			actorUserId,
			kind,
			reviewComment,
			syncVersion,
			target,
			threadId,
			threadMappingId,
		}: Omit<EchoParams, 'pullRequestId' | 'repositoryId'> & {
			authorActorId: GitHubActorId
			comment: GitHubSyncIssueComment | GitHubSyncReviewComment
			kind: 'issue' | 'review'
			reviewComment?: GitHubSyncReviewComment
			syncVersion: number
			threadId: PullRequestThreadId
			threadMappingId: GitHubPullRequestThreadMappingId
		}
	): Promise<void> {
		const [echoedComment] = await transaction
			.insert(pullRequestComments)
			.values({
				threadId,
				provider: 'github',
				authorUserId: actorUserId,
				body: comment.body,
				state: 'published',
				createdAt: comment.createdAt,
			})
			.returning({ id: pullRequestComments.id })

		if (!echoedComment) throw new Error('failed to echo GitHub comment')

		await transaction.insert(gitHubPullRequestCommentMappings).values({
			pullRequestMappingId: target.pullRequestMappingId,
			threadMappingId,
			pullRequestCommentId: echoedComment.id,
			kind,
			externalNodeId: comment.nodeId,
			externalNumericId: comment.numericId,
			authorActorId,
			parentExternalNumericId: reviewComment?.inReplyToNumericId,
			reviewExternalNumericId: reviewComment?.reviewNumericId,
			htmlUrl: comment.htmlUrl,
			subjectType: reviewComment?.subjectType,
			path: reviewComment?.path,
			side: reviewComment?.side,
			line: reviewComment?.line,
			originalLine: reviewComment?.originalLine,
			startSide: reviewComment?.startSide,
			startLine: reviewComment?.startLine,
			originalStartLine: reviewComment?.originalStartLine,
			commitId: reviewComment?.commitId,
			originalCommitId: reviewComment?.originalCommitId,
			diffHunk: reviewComment?.diffHunk,
			providerCreatedAt: comment.createdAt,
			providerUpdatedAt: comment.updatedAt,
			lastSeenSyncVersion: syncVersion,
		})
	}

	private async insertGitHubEvent(
		transaction: DrizzleTransaction,
		{
			actorId,
			createdAt,
			externalKey,
			payload,
			pullRequestId,
			type,
		}: {
			actorId: GitHubActorId
			createdAt: Date
			externalKey: string
			payload?: PullRequestEventPayload
			pullRequestId: PullRequestId
			type: PullRequestEvent['type']
		}
	): Promise<void> {
		const [existingMapping] = await transaction
			.select({ id: gitHubPullRequestEventMappings.id })
			.from(gitHubPullRequestEventMappings)
			.where(eq(gitHubPullRequestEventMappings.externalKey, externalKey))
			.limit(1)

		if (existingMapping) return

		const [event] = await transaction
			.insert(pullRequestEvents)
			.values({ pullRequestId, provider: 'github', type, payload, createdAt })
			.returning({ id: pullRequestEvents.id })

		if (!event) throw new Error('failed to echo GitHub timeline event')

		await transaction.insert(gitHubPullRequestEventMappings).values({
			pullRequestEventId: event.id,
			externalKey,
			actorId,
			createdAt,
		})
	}

	private async findActiveReviewerRequest(
		transaction: DrizzleTransaction,
		{
			pullRequestId,
			reviewerUserId,
		}: { pullRequestId: PullRequestId; reviewerUserId: UserId }
	) {
		const [request] = await transaction
			.select({ id: pullRequestReviewerRequests.id })
			.from(pullRequestReviewerRequests)
			.where(
				and(
					eq(pullRequestReviewerRequests.pullRequestId, pullRequestId),
					eq(pullRequestReviewerRequests.reviewerUserId, reviewerUserId),
					isNull(pullRequestReviewerRequests.removedAt),
					isNull(pullRequestReviewerRequests.fulfilledByReviewId)
				)
			)
			.limit(1)

		return request
	}

	private async findUserIdentityIn(
		db: Database | DrizzleTransaction,
		userId: UserId
	): Promise<GitHubUserIdentity | undefined> {
		const [actor] = await db
			.select({
				actorId: gitHubActors.id,
				externalNodeId: gitHubActors.externalNodeId,
				externalNumericId: gitHubActors.externalNumericId,
				login: gitHubActors.login,
			})
			.from(gitHubActors)
			.where(eq(gitHubActors.userId, userId))
			.limit(1)

		return actor
	}

	/** The projection's own lock; the version is raised first so mappings carry it. */
	private async echo<T>(
		{
			repositoryId,
			target,
		}: {
			repositoryId: RepositoryId
			target: Pick<GitHubPullRequestWriteTarget, 'externalNodeId'>
		},
		run: (transaction: DrizzleTransaction, syncVersion: number) => Promise<T>
	): Promise<T> {
		return await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${target.externalNodeId}, 0))`
			)

			return await run(
				transaction,
				await this.requestSyncIn(transaction, repositoryId)
			)
		})
	}

	async requestSync({
		repositoryId,
	}: {
		repositoryId: RepositoryId
	}): Promise<number> {
		return await this.db.transaction(
			async transaction => await this.requestSyncIn(transaction, repositoryId)
		)
	}

	// Version bump only: the dispatcher enqueues, keeping Redis out of pull requests.
	private async requestSyncIn(
		transaction: DrizzleTransaction,
		repositoryId: RepositoryId
	): Promise<number> {
		const [requested] = await transaction
			.update(repositoryExternalSources)
			.set({
				requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
				syncStatus: 'pending',
				syncFailureCode: null,
				syncFailureReason: null,
				nextSyncAt: new Date(),
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
					isNotNull(repositoryExternalSources.installationId),
					ne(repositoryExternalSources.syncStatus, 'blocked')
				)
			)
			.returning({
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})

		if (requested) return requested.requestedSyncVersion

		const [source] = await transaction
			.select({
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})
			.from(repositoryExternalSources)
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
			.limit(1)

		if (!source)
			throw new Error(
				'GitHub write-through echoed a repository it does not own'
			)

		return source.requestedSyncVersion
	}
}

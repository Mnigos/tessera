import { Database } from '@config/database'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import type { GitHubPendingPullRequestEvent } from '@modules/github-sync/infrastructure/github-sync.repository'
import { Injectable } from '@nestjs/common'
import type {
	PullRequestDraftFilter,
	PullRequestSort,
	PullRequestSortDirection,
} from '@repo/contracts'
import type {
	GitHubActorId,
	GitHubPullRequestAssignee,
	GitHubPullRequestLabel,
	GitHubWebhookDeliveryId,
} from '@repo/db'
import {
	and,
	asc,
	type DrizzleTransaction,
	desc,
	eq,
	gitHubActors,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	ilike,
	inArray,
	isNull,
	lte,
	ne,
	or,
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
	MergeQueueState,
	MergeStrategy,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import type { SQL } from 'drizzle-orm'
import { alias, type PgColumn } from 'drizzle-orm/pg-core'
import type { PullRequestActorReadModel } from '../domain/pull-request-actor'
import type { PullRequestPushRefUpdate } from '../domain/pull-request-push.schema'
import type { PullRequestCursor } from '../helpers/pull-request-cursor'
import type { PullRequestMergeRequest } from '../helpers/pull-request-merge-request'
import {
	toPullRequestNumberQuery,
	toPullRequestSearchPattern,
} from '../helpers/pull-request-search'
import {
	completeMergeQueueEntry,
	findActiveMergeQueueState,
	holdsRepositoryMergeLease,
	removeActiveMergeQueueEntry,
} from './merge-queue.transactions'
import { touchPullRequestActivity } from './pull-request-activity.transactions'

interface RepositoryParams {
	repositoryId: RepositoryId
}

interface PullRequestNumberParams extends RepositoryParams {
	number: number
}

interface ListParams extends RepositoryParams {
	state?: PullRequest['state']
	draft?: PullRequestDraftFilter
	/** Free text matched across the row's own fields and its author's login. */
	q?: string
	sort: PullRequestSort
	direction: PullRequestSortDirection
	limit: number
	/** Where the previous page stopped; absent for the first page. */
	cursor?: PullRequestCursor
}

/**
 * A list row carrying the value it was ordered by, rendered at the precision
 * Postgres stores it with. A `Date` would round the microseconds away, and the
 * cursor built from it would then either repeat or skip every row sharing a
 * millisecond with the last one on the page.
 */
export interface PullRequestListReadModel extends PullRequestReadModel {
	sortValue: string
}

export interface PullRequestListPage {
	pullRequests: PullRequestListReadModel[]
	/** Whether a further page exists under this same ordering. */
	hasMore: boolean
	/**
	 * Whether the repository holds any pull request at all, filters ignored —
	 * what separates "nothing matched" from "nothing has been opened yet".
	 */
	hasAnyPullRequests: boolean
}

const SORT_COLUMNS = {
	created: pullRequests.createdAt,
	updated: pullRequests.updatedAt,
	activity: pullRequests.lastActivityAt,
} as const satisfies Record<PullRequestSort, PgColumn>

interface CreateParams extends RepositoryParams {
	authorUserId: UserId
	sourceBranch: string
	targetBranch: string
	openingBaseSha: string
	openingHeadSha: string
	title: string
	body: string
}

interface ClearBranchDiffStatsParams extends RepositoryParams {
	branches: string[]
}

export interface ReconciledGitHubPullRequest {
	id: PullRequestId
	/** Whether the mapped pair moved, which is what dates the cached diff totals. */
	comparisonChanged: boolean
}

interface WriteDiffStatsParams {
	pullRequestId: PullRequestId
	baseSha: string
	headSha: string
	additions: number
	deletions: number
	changedFiles: number
	commitCount?: number
	computedAt: Date
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

interface RetargetParams extends PullRequestMutationParams {
	/** The target the refs were validated against, so a move that raced this one is refused. */
	expectedTargetBranch: string
	/** The repository merge lease this caller took, re-proved inside the transaction. */
	leaseOwner: string
	targetBranch: string
}

/**
 * What became of an attempt to move a target branch. The refusals are different
 * things to tell the person who asked: one is worth retrying after a refresh,
 * one once the repository's merge work settles, one once this pull request's own
 * merge does, and one only after they take it out of the queue. `unchanged` is
 * not a refusal at all — the target is already where it was asked to be.
 */
export type RetargetPullRequestResult =
	| { status: 'retargeted'; pullRequest: PullRequest }
	| { status: 'unchanged'; pullRequest: PullRequest }
	| { status: 'pull_request_unavailable' }
	| { status: 'lease_lost' }
	| { status: 'merge_in_progress' }
	| { status: 'queued'; queueState: MergeQueueState }

interface ClaimMergeParams extends PullRequestMutationParams {
	attemptId: string
	/** Present only when the attempt is deliberately merging past policy. */
	bypass?: PullRequestMergeBypass
	/** What this attempt intends to ask Git for, if it is the first to arrive. */
	request: PullRequestMergeRequest
	staleBefore: Date
	startedAt: Date
}

interface FindRecoverableMergeIntentParams {
	pullRequestId: PullRequestId
	staleBefore: Date
}

/**
 * A merge attempt that stopped existing before it finished recording itself.
 *
 * Whether it reached Git at all is not knowable from here — that is what the
 * operation receipt answers. The request is carried so the receipt can be looked
 * up against the exact merge this attempt was making, and the actor and waiver
 * so the merge is recorded as the one it was cleared to be rather than as
 * whoever happened to arrive next.
 *
 * The request is absent on intents written before it was recorded, which the
 * strategies migration deliberately left in place. Those cannot be looked up and
 * cannot be replayed; recovery releases them.
 */
export interface RecoverableMergeIntent {
	actor: PullRequestMergeIntentActor
	/** The attempt that wrote it, so the recovery finishes or releases that one. */
	attemptId: string
	bypass?: PullRequestMergeBypass
	request?: PullRequestMergeRequest
	startedAt: Date
}

export interface PullRequestMergeIntentActor {
	email: string
	id: UserId
	name: string
}

/** The merge this attempt now holds, and what it is cleared to do. */
export interface ClaimedPullRequestMerge {
	/** An earlier attempt's waiver carries forward when this one brought none. */
	bypass?: PullRequestMergeBypass
	pullRequest: PullRequest
	request: PullRequestMergeRequest
}

interface RecordMergeBlockedParams {
	actorUserId: UserId
	payload: PullRequestMergeBlockedEventPayload
	pullRequestId: PullRequestId
}

interface CompleteMergeParams extends LifecycleParams {
	attemptId: string
	/** Where the target branch was left, whichever strategy put it there. */
	resultingSha: string
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
	/** The account that identity is linked to, which a synchronized row has instead of an author. */
	authorActorUserId?: UserId
	github?: {
		nodeId: string
		htmlUrl: string
		draft: boolean
		headSha: string
		baseSha: string
		mergedByUsername?: string
		externalNumber?: number
		labels?: GitHubPullRequestLabel[]
		assignees?: GitHubPullRequestAssignee[]
		mergeableState?: 'mergeable' | 'conflicting' | 'unknown'
	}
}

/** The delivery key is write-side bookkeeping and never part of the timeline. */
export interface PullRequestEventReadModel
	extends Omit<PullRequestEvent, 'idempotencyKey'> {
	actorUsername?: string
	actor?: PullRequestActorReadModel
}

interface PullRequestReadRow extends PullRequest {
	authorUsername: string
	authorActorNodeId: string | null
	authorActorUserId: UserId | null
	githubNodeId: string | null
	githubHtmlUrl: string | null
	githubDraft: boolean | null
	githubHeadSha: string | null
	githubBaseSha: string | null
	githubMergedByUsername: string | null
	githubExternalNumber: number | null
	githubLabels: GitHubPullRequestLabel[] | null
	githubAssignees: GitHubPullRequestAssignee[] | null
	githubMergeableState: 'mergeable' | 'conflicting' | 'unknown' | null
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
	mergeStrategy: pullRequests.mergeStrategy,
	mergedBaseSha: pullRequests.mergedBaseSha,
	mergedHeadSha: pullRequests.mergedHeadSha,
	mergeActorUserId: pullRequests.mergeActorUserId,
	diffStatsBaseSha: pullRequests.diffStatsBaseSha,
	diffStatsHeadSha: pullRequests.diffStatsHeadSha,
	diffAdditions: pullRequests.diffAdditions,
	diffDeletions: pullRequests.diffDeletions,
	diffChangedFiles: pullRequests.diffChangedFiles,
	diffCommitCount: pullRequests.diffCommitCount,
	diffStatsUpdatedAt: pullRequests.diffStatsUpdatedAt,
	createdAt: pullRequests.createdAt,
	updatedAt: pullRequests.updatedAt,
	lastActivityAt: pullRequests.lastActivityAt,
	closedAt: pullRequests.closedAt,
	mergedAt: pullRequests.mergedAt,
}

const CLEARED_DIFF_STATS = {
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	// Caching a diff is not a change to the pull request itself.
	updatedAt: sql`${pullRequests.updatedAt}`,
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
	authorActorUserId: authorGitHubActor.userId,
	githubNodeId: gitHubPullRequestMappings.externalNodeId,
	githubHtmlUrl: gitHubPullRequestMappings.htmlUrl,
	githubDraft: gitHubPullRequestMappings.draft,
	githubHeadSha: gitHubPullRequestMappings.headSha,
	githubBaseSha: gitHubPullRequestMappings.baseSha,
	githubMergedByUsername: mergedByGitHubActor.login,
	githubExternalNumber: gitHubPullRequestMappings.externalNumber,
	githubLabels: gitHubPullRequestMappings.labels,
	githubAssignees: gitHubPullRequestMappings.assignees,
	githubMergeableState: gitHubPullRequestMappings.providerMergeableState,
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

	/**
	 * One page of a repository's pull requests, ordered by the requested sort key
	 * and paginated by keyset rather than by offset: the composite indexes make
	 * every page a single range scan, and rows opened while someone reads page one
	 * cannot shift page two out from under them.
	 */
	async list({
		cursor,
		direction,
		draft,
		limit,
		q,
		repositoryId,
		sort,
		state,
	}: ListParams): Promise<PullRequestListPage> {
		const sortColumn = SORT_COLUMNS[sort]
		const conditions: (SQL | undefined)[] = [
			eq(pullRequests.repositoryId, repositoryId),
		]

		if (state) conditions.push(eq(pullRequests.state, state))

		// Only a mirrored pull request can be a draft, so an unmapped row is not
		// one; `only` therefore excludes every native pull request by construction.
		if (draft === 'only')
			conditions.push(eq(gitHubPullRequestMappings.draft, true))
		else if (draft === 'exclude')
			conditions.push(
				or(
					isNull(gitHubPullRequestMappings.draft),
					eq(gitHubPullRequestMappings.draft, false)
				)
			)

		const search = q ? toPullRequestSearchCondition(q) : undefined

		if (search) conditions.push(search)

		// A row comparison rather than the disjunction it expands to: it is what
		// the index can satisfy in one scan, and the tie-breaker is only correct
		// while it points the same way the sort key does.
		if (cursor)
			conditions.push(
				direction === 'desc'
					? sql`(${sortColumn}, ${pullRequests.number}) < (${cursor.value}::timestamp, ${cursor.number})`
					: sql`(${sortColumn}, ${pullRequests.number}) > (${cursor.value}::timestamp, ${cursor.number})`
			)

		const order = direction === 'desc' ? desc : asc
		// One row past the page, purely to learn whether a next page exists.
		const [rows, hasAnyPullRequests] = await Promise.all([
			this.db
				.select({
					...PULL_REQUEST_READ_COLUMNS,
					sortValue: sql<string>`to_char(${sortColumn}, 'YYYY-MM-DD HH24:MI:SS.US')`,
				})
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
				.orderBy(order(sortColumn), order(pullRequests.number))
				.limit(limit + 1),
			this.hasAnyPullRequests(repositoryId),
		])

		return {
			pullRequests: rows.slice(0, limit).map(row => ({
				...toPullRequestReadModel(row),
				sortValue: row.sortValue,
			})),
			hasMore: rows.length > limit,
			hasAnyPullRequests,
		}
	}

	private async hasAnyPullRequests(
		repositoryId: RepositoryId
	): Promise<boolean> {
		const [existing] = await this.db
			.select({ id: pullRequests.id })
			.from(pullRequests)
			.where(eq(pullRequests.repositoryId, repositoryId))
			.limit(1)

		return existing !== undefined
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
				// The joins the login already came from, read whole: the avatar and
				// the profile were always beside it, they were just never selected.
				actor: {
					userId: pullRequestEvents.actorUserId,
					username: eventActorUser.username,
					displayName: eventActorUser.name,
					imageUrl: eventActorUser.image,
					externalNodeId: eventGitHubActor.externalNodeId,
					externalLogin: eventGitHubActor.login,
					externalAvatarUrl: eventGitHubActor.avatarUrl,
					externalHtmlUrl: eventGitHubActor.htmlUrl,
				},
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

	async clearBranchDiffStats({
		branches,
		repositoryId,
	}: ClearBranchDiffStatsParams): Promise<void> {
		await this.db
			.update(pullRequests)
			.set(CLEARED_DIFF_STATS)
			.where(
				and(
					eq(pullRequests.repositoryId, repositoryId),
					eq(pullRequests.provider, 'tessera'),
					eq(pullRequests.state, 'open'),
					or(
						inArray(pullRequests.sourceBranch, branches),
						inArray(pullRequests.targetBranch, branches)
					)
				)
			)
	}

	async clearDiffStats(pullRequestId: PullRequestId): Promise<void> {
		await this.db
			.update(pullRequests)
			.set(CLEARED_DIFF_STATS)
			.where(eq(pullRequests.id, pullRequestId))
	}

	/** A comparison that started before the stored one cannot undo it. */
	async writeDiffStats({
		additions,
		baseSha,
		changedFiles,
		commitCount,
		computedAt,
		deletions,
		headSha,
		pullRequestId,
	}: WriteDiffStatsParams): Promise<void> {
		await this.db
			.update(pullRequests)
			.set({
				diffStatsBaseSha: baseSha,
				diffStatsHeadSha: headSha,
				diffAdditions: additions,
				diffDeletions: deletions,
				diffChangedFiles: changedFiles,
				diffCommitCount: commitCount ?? null,
				diffStatsUpdatedAt: computedAt,
				updatedAt: sql`${pullRequests.updatedAt}`,
			})
			.where(
				and(
					eq(pullRequests.id, pullRequestId),
					or(
						isNull(pullRequests.diffStatsUpdatedAt),
						lte(pullRequests.diffStatsUpdatedAt, computedAt)
					)
				)
			)
	}

	async reconcileGitHubPullRequest({
		authorActorId,
		mergedByActorId,
		pendingEvents,
		pullRequest,
		repositoryId,
	}: ReconcileGitHubPullRequestParams): Promise<ReconciledGitHubPullRequest> {
		const providerMergeableState = pullRequest.mergeableState ?? null
		// A failed stats read leaves no verdict; the one already stored outlives
		// it rather than being erased by a blind write.
		const preservedMergeableState =
			pullRequest.mergeableState ??
			sql`${gitHubPullRequestMappings.providerMergeableState}`

		return await this.db.transaction(async transaction => {
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${pullRequest.nodeId}, 0))`
			)
			const [existingMapping] = await transaction
				.select({
					pullRequestId: gitHubPullRequestMappings.pullRequestId,
					repositoryId: gitHubPullRequestMappings.repositoryId,
					providerUpdatedAt: gitHubPullRequestMappings.providerUpdatedAt,
					headSha: gitHubPullRequestMappings.headSha,
					baseSha: gitHubPullRequestMappings.baseSha,
				})
				.from(gitHubPullRequestMappings)
				.where(eq(gitHubPullRequestMappings.externalNodeId, pullRequest.nodeId))
				.limit(1)
				.for('update')

			if (existingMapping && existingMapping.repositoryId !== repositoryId)
				throw new Error(
					'GitHub pull request mapping belongs to another repository'
				)

			// A snapshot older than the mapping already holds never rewrites it.
			const isStale =
				existingMapping !== undefined &&
				existingMapping.providerUpdatedAt > pullRequest.updatedAt
			const pullRequestId = existingMapping?.pullRequestId
				? await this.updateGitHubPullRequest(transaction, {
						isStale,
						pullRequestId: existingMapping.pullRequestId,
						pullRequest,
					})
				: await this.createGitHubPullRequest(transaction, {
						repositoryId,
						pullRequest,
					})

			if (!isStale)
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
						labels: pullRequest.labels,
						assignees: pullRequest.assignees,
						providerMergeableState,
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
							labels: pullRequest.labels,
							assignees: pullRequest.assignees,
							providerMergeableState: preservedMergeableState,
							providerUpdatedAt: pullRequest.updatedAt,
							providerClosedAt: pullRequest.closedAt ?? null,
							providerMergedAt: pullRequest.mergedAt ?? null,
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

			return {
				id: pullRequestId,
				comparisonChanged:
					existingMapping?.headSha !== pullRequest.headSha ||
					existingMapping.baseSha !== pullRequest.baseSha,
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
			// A snapshotted intent may describe a merge Git already made, and
			// deleting it here would close a pull request that was in fact merged,
			// with nothing left to prove it. Only recovery resolves one — the
			// service runs it before closing, so reaching this with one still in
			// place means it could not be resolved, and the close is refused.
			if (mergeIntent && toPersistedMergeRequest(mergeIntent)) return undefined

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

	/**
	 * Moves an open pull request onto another target branch, and records where it
	 * was moved from.
	 *
	 * Everything that could contradict the move is re-read under the pull
	 * request's own row lock rather than trusted from the service's earlier look:
	 * the target it validated against, the merge intent it settled, and the queue
	 * entry it found nothing of. The caller holds the repository merge lease
	 * throughout, so an intent still here is a merge in flight or one recovery
	 * could not resolve — and both were cleared against the target this would
	 * move.
	 *
	 * Nothing else on the row is touched. The opening SHAs are what the pull
	 * request was created against and stay that way; every comparison an open pull
	 * request has is resolved from the live branches and self-heals on the next
	 * read.
	 */
	async retarget({
		actorUserId,
		expectedTargetBranch,
		leaseOwner,
		pullRequestId,
		repositoryId,
		targetBranch,
	}: RetargetParams): Promise<RetargetPullRequestResult> {
		return await this.db.transaction(async tx => {
			// Fenced before anything is read, because the caller acquiring the lease
			// is not the same thing as still holding it: recovery can outlast the
			// TTL, and a merge that took the expired lease may already have resolved
			// the branches this transaction would move underneath it.
			if (
				!(await holdsRepositoryMergeLease(tx, {
					owner: leaseOwner,
					repositoryId,
				}))
			)
				return { status: 'lease_lost' }

			const lockedPullRequest = await this.lockPullRequest(tx, {
				pullRequestId,
				repositoryId,
			})

			if (lockedPullRequest?.state !== 'open')
				return { status: 'pull_request_unavailable' }

			// The move already happened — by an identical request that got here
			// first, so this one asked for a state that now holds. Reporting a
			// conflict would fail a retry for having succeeded, so the row comes back
			// unchanged and no second event claims the branch moved twice.
			if (lockedPullRequest.targetBranch === targetBranch)
				return { status: 'unchanged', pullRequest: lockedPullRequest }

			if (lockedPullRequest.targetBranch !== expectedTargetBranch)
				return { status: 'pull_request_unavailable' }

			const mergeIntent = await this.findMergeIntent(tx, pullRequestId)
			if (mergeIntent) return { status: 'merge_in_progress' }

			// Blocked rather than removed: the entry says what its author queued, and
			// deciding for them that a differently-targeted merge is what they meant
			// is not this endpoint's to make.
			const queueState = await findActiveMergeQueueState(tx, pullRequestId)
			if (queueState) return { status: 'queued', queueState }

			const [pullRequest] = await tx
				.update(pullRequests)
				.set({ targetBranch })
				.where(
					and(
						eq(pullRequests.id, pullRequestId),
						eq(pullRequests.repositoryId, repositoryId),
						eq(pullRequests.state, 'open')
					)
				)
				.returning(PULL_REQUEST_COLUMNS)

			if (!pullRequest) return { status: 'pull_request_unavailable' }

			await this.createEvent(tx, {
				pullRequestId,
				actorUserId,
				type: 'retargeted',
				payload: {
					fromBranch: lockedPullRequest.targetBranch,
					toBranch: targetBranch,
				},
			})

			return { status: 'retargeted', pullRequest }
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

	/**
	 * An aged-out merge intent, whatever it recorded.
	 *
	 * Read before anything is re-evaluated, because the world it describes may
	 * already have changed by its own hand: if Git performed the merge and the
	 * process died before recording it, the target has moved and a fresh
	 * evaluation would call this attempt stale rather than finish it.
	 *
	 * Recovery is the only thing that resolves one of these. Nothing else may
	 * overwrite or delete a snapshotted intent, which is what keeps the evidence
	 * of a merge Git already made from being destroyed by whoever arrives next.
	 */
	async findRecoverableMergeIntent({
		pullRequestId,
		staleBefore,
	}: FindRecoverableMergeIntentParams): Promise<
		RecoverableMergeIntent | undefined
	> {
		const [row] = await this.db
			.select({
				actorUserId: pullRequestMergeIntents.actorUserId,
				actorName: user.name,
				actorEmail: user.email,
				attemptId: pullRequestMergeIntents.attemptId,
				bypass: pullRequestMergeIntents.bypass,
				strategy: pullRequestMergeIntents.strategy,
				expectedBaseSha: pullRequestMergeIntents.expectedBaseSha,
				expectedHeadSha: pullRequestMergeIntents.expectedHeadSha,
				commitMessage: pullRequestMergeIntents.commitMessage,
				squashTitle: pullRequestMergeIntents.squashTitle,
				squashBody: pullRequestMergeIntents.squashBody,
				startedAt: pullRequestMergeIntents.startedAt,
			})
			.from(pullRequestMergeIntents)
			.innerJoin(user, eq(user.id, pullRequestMergeIntents.actorUserId))
			.where(
				and(
					eq(pullRequestMergeIntents.pullRequestId, pullRequestId),
					lte(pullRequestMergeIntents.startedAt, staleBefore)
				)
			)
			.limit(1)

		if (!row) return undefined

		return {
			request: toPersistedMergeRequest(row),
			actor: {
				id: row.actorUserId,
				name: row.actorName,
				email: row.actorEmail,
			},
			attemptId: row.attemptId,
			bypass: row.bypass ?? undefined,
			startedAt: row.startedAt,
		}
	}

	/**
	 * Takes the pull request's merge intent, writing down exactly what Git is
	 * about to be asked for.
	 *
	 * An intent that recorded what it was asking Git for is never overwritten,
	 * however old it is. Only recovery resolves one of those, because only
	 * recovery can ask Git whether that request was carried out — and an intent
	 * that ages past the recovery cutoff a moment after recovery looked would
	 * otherwise be overwritten here, destroying the evidence of a merge that had
	 * already happened. Such a claim is refused, and the caller reports the merge
	 * as being in progress; the next attempt recovers it.
	 *
	 * What is left to take over is an intent that recorded nothing — one written
	 * before requests were snapshotted. Its waiver carries forward, because a
	 * merge an earlier attempt was cleared to make is still a bypassed merge, and
	 * this attempt has been evaluated on its own terms regardless.
	 */
	async claimMerge({
		actorUserId,
		attemptId,
		bypass,
		pullRequestId,
		repositoryId,
		request,
		staleBefore,
		startedAt,
	}: ClaimMergeParams): Promise<ClaimedPullRequestMerge | undefined> {
		return await this.db.transaction(async tx => {
			const lockedPullRequest = await this.lockPullRequest(tx, {
				pullRequestId,
				repositoryId,
			})

			if (lockedPullRequest?.state !== 'open') return undefined
			const mergeIntent = await this.findMergeIntent(tx, pullRequestId)
			if (mergeIntent && mergeIntent.startedAt > staleBefore) return undefined
			if (mergeIntent && toPersistedMergeRequest(mergeIntent)) return undefined

			const claimedBypass = bypass ?? mergeIntent?.bypass ?? undefined

			if (mergeIntent)
				await tx
					.update(pullRequestMergeIntents)
					.set({
						attemptId,
						actorUserId,
						startedAt,
						bypass: claimedBypass,
						...toMergeIntentRequestColumns(request),
					})
					.where(eq(pullRequestMergeIntents.pullRequestId, pullRequestId))
			else
				await tx.insert(pullRequestMergeIntents).values({
					pullRequestId,
					attemptId,
					actorUserId,
					bypass: claimedBypass,
					startedAt,
					...toMergeIntentRequestColumns(request),
				})

			return {
				bypass: claimedBypass,
				pullRequest: lockedPullRequest,
				request,
			}
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
		pullRequestId,
		queueEntryId,
		repositoryId,
		resultingSha,
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

			// What was merged is read from the claimed intent rather than from the
			// caller, for the same reason the bypass audit is: the intent is what Git
			// was actually asked for, and it survives a process that did not.
			const request = toPersistedMergeRequest(mergeIntent)
			const [pullRequest] = await tx
				.update(pullRequests)
				.set({
					state: 'merged',
					mergeCommitSha: resultingSha,
					mergeStrategy: mergeIntent.strategy,
					mergedBaseSha: request?.expectedBaseSha,
					mergedHeadSha: request?.expectedHeadSha,
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
				// An intent written before requests were snapshotted has no pair to
				// name, so the event stays payload-less exactly as it used to be.
				payload: request && {
					strategy: request.strategy,
					resultingSha,
					baseSha: request.expectedBaseSha,
					headSha: request.expectedHeadSha,
				},
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
					.returning({
						id: pullRequestEvents.id,
						pullRequestId: pullRequestEvents.pullRequestId,
					})

				// Only the pull requests that actually took an event: a redelivery
				// conflicts its rows away and has moved nothing.
				await touchPullRequestActivity(tx, {
					pullRequestIds: events.map(event => event.pullRequestId),
					occurredAt,
				})

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
		await touchPullRequestActivity(db, {
			pullRequestIds: [params.pullRequestId],
		})
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
				actorUserId: pullRequestMergeIntents.actorUserId,
				attemptId: pullRequestMergeIntents.attemptId,
				bypass: pullRequestMergeIntents.bypass,
				strategy: pullRequestMergeIntents.strategy,
				expectedBaseSha: pullRequestMergeIntents.expectedBaseSha,
				expectedHeadSha: pullRequestMergeIntents.expectedHeadSha,
				commitMessage: pullRequestMergeIntents.commitMessage,
				squashTitle: pullRequestMergeIntents.squashTitle,
				squashBody: pullRequestMergeIntents.squashBody,
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
		// A mirrored pull request keeps GitHub's number; the counter is only
		// pushed past it so a later local allocation can never collide.
		await this.reservePullRequestNumber(
			transaction,
			repositoryId,
			pullRequest.number
		)

		const [createdPullRequest] = await transaction
			.insert(pullRequests)
			.values({
				repositoryId,
				provider: 'github',
				number: pullRequest.number,
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
				// Seeded rather than defaulted: a first sync of a long-dormant pull
				// request would otherwise land at the top of the activity ordering.
				lastActivityAt: pullRequest.updatedAt,
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
			isStale,
			pullRequest,
			pullRequestId,
		}: {
			isStale: boolean
			pullRequest: GitHubSyncPullRequest
			pullRequestId: PullRequestId
		}
	): Promise<PullRequestId> {
		if (isStale) return pullRequestId

		const [updatedPullRequest] = await transaction
			.update(pullRequests)
			.set({
				sourceBranch: pullRequest.sourceBranch,
				targetBranch: pullRequest.targetBranch,
				title: pullRequest.title,
				body: pullRequest.body,
				state: pullRequest.state,
				mergeCommitSha: pullRequest.mergeCommitSha ?? null,
				updatedAt: pullRequest.updatedAt,
				// A mirror's own events are backfilled piecemeal, so GitHub's update
				// time is the only activity signal every reconciled row carries.
				lastActivityAt: sql`greatest(${pullRequests.lastActivityAt}, ${pullRequest.updatedAt.toISOString()}::timestamp)`,
				closedAt: pullRequest.closedAt ?? null,
				mergedAt: pullRequest.mergedAt ?? null,
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

	private async reservePullRequestNumber(
		transaction: PullRequestDatabase,
		repositoryId: RepositoryId,
		number: number
	): Promise<void> {
		await transaction
			.insert(repositoryPullRequestCounters)
			.values({ repositoryId, nextNumber: number + 1 })
			.onConflictDoUpdate({
				target: repositoryPullRequestCounters.repositoryId,
				set: {
					nextNumber: sql`greatest(${repositoryPullRequestCounters.nextNumber}, ${number + 1})`,
				},
			})
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

		await touchPullRequestActivity(transaction, {
			pullRequestIds: [pullRequestId],
			occurredAt: createdAt,
		})

		await transaction.insert(gitHubPullRequestEventMappings).values({
			pullRequestEventId: event.id,
			externalKey,
			actorId,
			deliveryId,
			createdAt,
		})
	}
}

/**
 * Everything one search term can match: the pull request's own text and
 * branches, its author's login under either provider, and — when the term reads
 * as a number — that number exactly, which substring matching alone would find
 * only by accident.
 *
 * The whole disjunction is matched by scan rather than by index: an OR is only
 * index-served when every arm is, and the author arms live on joined tables no
 * pull_requests index can cover. The repository-scoped composite predicate has
 * already narrowed the rows the scan reads.
 */
function toPullRequestSearchCondition(query: string): SQL | undefined {
	const pattern = toPullRequestSearchPattern(query)
	const matches = [
		ilike(pullRequests.title, pattern),
		ilike(pullRequests.body, pattern),
		ilike(pullRequests.sourceBranch, pattern),
		ilike(pullRequests.targetBranch, pattern),
		ilike(authorUser.username, pattern),
		ilike(authorGitHubActor.login, pattern),
	]
	const number = toPullRequestNumberQuery(query)

	if (number !== undefined) matches.push(eq(pullRequests.number, number))

	return or(...matches)
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
		authorActorUserId: pullRequest.authorActorUserId ?? undefined,
		sourceBranch: pullRequest.sourceBranch,
		targetBranch: pullRequest.targetBranch,
		openingBaseSha: pullRequest.openingBaseSha,
		openingHeadSha: pullRequest.openingHeadSha,
		title: pullRequest.title,
		body: pullRequest.body,
		state: pullRequest.state,
		mergeCommitSha: pullRequest.mergeCommitSha,
		mergeStrategy: pullRequest.mergeStrategy,
		mergedBaseSha: pullRequest.mergedBaseSha,
		mergedHeadSha: pullRequest.mergedHeadSha,
		mergeActorUserId: pullRequest.mergeActorUserId,
		createdAt: pullRequest.createdAt,
		updatedAt: pullRequest.updatedAt,
		lastActivityAt: pullRequest.lastActivityAt,
		closedAt: pullRequest.closedAt,
		mergedAt: pullRequest.mergedAt,
		diffStatsBaseSha: pullRequest.diffStatsBaseSha,
		diffStatsHeadSha: pullRequest.diffStatsHeadSha,
		diffAdditions: pullRequest.diffAdditions,
		diffDeletions: pullRequest.diffDeletions,
		diffChangedFiles: pullRequest.diffChangedFiles,
		diffCommitCount: pullRequest.diffCommitCount,
		diffStatsUpdatedAt: pullRequest.diffStatsUpdatedAt,
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
						externalNumber: pullRequest.githubExternalNumber ?? undefined,
						// Null is a mapping written before the columns existed, which is
						// indistinguishable from a pull request GitHub labelled with nothing.
						labels: pullRequest.githubLabels ?? [],
						assignees: pullRequest.githubAssignees ?? [],
						mergeableState: pullRequest.githubMergeableState ?? undefined,
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

/**
 * The stored request, or nothing when the row predates requests being stored.
 *
 * The database refuses a half-written snapshot, so the tips being present is
 * enough to know the whole request is: whatever message fields the strategy
 * needs are there beside them.
 */
function toPersistedMergeRequest(intent: {
	commitMessage: string | null
	expectedBaseSha: string | null
	expectedHeadSha: string | null
	squashBody: string | null
	squashTitle: string | null
	strategy: MergeStrategy
}): PullRequestMergeRequest | undefined {
	if (!(intent.expectedBaseSha && intent.expectedHeadSha)) return undefined

	return {
		strategy: intent.strategy,
		expectedBaseSha: intent.expectedBaseSha,
		expectedHeadSha: intent.expectedHeadSha,
		commitMessage: intent.commitMessage ?? undefined,
		squashTitle: intent.squashTitle ?? undefined,
		squashBody: intent.squashBody ?? undefined,
	}
}

/**
 * Nulls rather than absences, so taking over an intent overwrites whatever the
 * previous strategy left behind instead of merging the two requests together.
 */
function toMergeIntentRequestColumns(request: PullRequestMergeRequest) {
	return {
		strategy: request.strategy,
		expectedBaseSha: request.expectedBaseSha,
		expectedHeadSha: request.expectedHeadSha,
		commitMessage: request.commitMessage ?? null,
		squashTitle: request.squashTitle ?? null,
		squashBody: request.squashBody ?? null,
	}
}

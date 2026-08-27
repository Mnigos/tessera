import { randomUUID } from 'node:crypto'
import {
	GitStorageClient,
	type GitStorageRepositoryBlob,
	type GitStorageRepositoryComparison,
} from '@config/git-storage'
import { BranchProtectionService } from '@modules/branch-protection'
import { ChecksReadService } from '@modules/checks'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import type { GitHubPendingPullRequestEvent } from '@modules/github-sync/infrastructure/github-sync.repository'
import {
	type GitHubWriteThroughContext,
	GitHubWriteThroughService,
	toGitHubWriteThroughContext,
} from '@modules/github-write-through'
import {
	type GitHubWriteThroughTarget,
	RepositoriesService,
} from '@modules/repositories'
import { Injectable, Logger } from '@nestjs/common'
import type {
	ChecksList,
	ListPullRequestsResult,
	MergeBlockingReason,
	MergePullRequestResult,
	MergeRequirements,
	MergeStrategySelection,
	ParsedCreatePullRequestInput,
	ParsedEditPullRequestInput,
	ParsedGetPullRequestFileDiffInput,
	ParsedGetPullRequestFileLinesInput,
	ParsedGetPullRequestInput,
	ParsedGetPullRequestReviewComparisonInput,
	ParsedListPullRequestChecksInput,
	ParsedListPullRequestsInput,
	ParsedMergePullRequestInput,
	ParsedRetargetPullRequestInput,
	PullRequest,
	PullRequestComparison,
	PullRequestDiffStats,
	PullRequestFileDiff,
	PullRequestFileLines,
	PullRequestReviewComparison,
	PullRequestReviewComparisonContext,
	PullRequestReviewSummary,
} from '@repo/contracts'
import type { GitHubActorId, PullRequest as PullRequestEntity } from '@repo/db'
import type {
	MergeQueueEntryId,
	MergeStrategy,
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositoryRole,
	UserId,
} from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import { RepositoryMergeInProgressError } from '../domain/merge-queue.errors'
import {
	assertPullRequestClosable,
	assertPullRequestEditable,
	assertPullRequestReopenable,
	assertPullRequestRetargetable,
	toPullRequestEventOutput,
	toPullRequestOutput,
} from '../domain/pull-request'
import {
	PullRequestAlreadyOpenError,
	PullRequestFileContentNotFoundError,
	PullRequestInvalidBranchesError,
	PullRequestMergeInProgressError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestQueuedError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { toPullRequestReviewComparisonContext } from '../domain/pull-request-review'
import { PullRequestReviewNotFoundError } from '../domain/pull-request-review.errors'
import {
	toMergeAuthorityReasons,
	toMergePermissionReasons,
} from '../helpers/merge-authority-reasons'
import { toMergeBypassContext } from '../helpers/merge-bypass-context'
import { toPullRequestAuthority } from '../helpers/pull-request-authority'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import {
	decodePullRequestCursor,
	encodePullRequestCursor,
} from '../helpers/pull-request-cursor'
import {
	highlightPullRequestDiff,
	highlightPullRequestFileLines,
} from '../helpers/pull-request-diff-highlighting'
import { toPullRequestMergeRequest } from '../helpers/pull-request-merge-request'
import { isMissingGitObjectError } from '../helpers/pull-request-storage-error'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
	type RecoverableMergeIntent,
	type RetargetPullRequestResult,
} from '../infrastructure/pull-requests.repository'
import { MergeQueueStatusService } from './merge-queue-status.service'
import { MergeRequirementsService } from './merge-requirements.service'
import { PullRequestHeadResolver } from './pull-request-head.resolver'
import {
	MERGE_INTENT_LEASE_MS,
	type PullRequestMergeActor,
	type PullRequestMergeRefusal,
	PullRequestMergeRunner,
	REPOSITORY_MERGE_LEASE_MS,
} from './pull-request-merge.runner'
import { PullRequestReviewsService } from './pull-request-reviews.service'

export type { PullRequestMergeActor } from './pull-request-merge.runner'

const OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT = new Set([
	'pull_requests_open_branch_pair_unique',
])
const EMPTY_REVIEW_SUMMARY: PullRequestReviewSummary = {
	requestedCount: 0,
	approvedCount: 0,
	changeRequestCount: 0,
	staleCount: 0,
}

interface MergeUnderLeaseParams {
	actor: PullRequestMergeActor
	bypass?: ParsedMergePullRequestInput['bypass']
	expected: { baseSha: string; headSha: string }
	leaseOwner: string
	number: number
	repositoryId: RepositoryId
	selection: MergeStrategySelection
	storagePath: string
	tesseraWritesAllowed: boolean
	username: string
	viewerRole: RepositoryRole
}

@Injectable()
export class PullRequestsService {
	private readonly logger = new Logger(PullRequestsService.name)

	constructor(
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly pullRequestReviewsService: PullRequestReviewsService,
		private readonly pullRequestHeadResolver: PullRequestHeadResolver,
		private readonly checksReadService: ChecksReadService,
		private readonly branchProtectionService: BranchProtectionService,
		private readonly repositoriesService: RepositoriesService,
		private readonly mergeRequirementsService: MergeRequirementsService,
		private readonly mergeQueueRepository: MergeQueueRepository,
		private readonly mergeQueueStatusService: MergeQueueStatusService,
		private readonly pullRequestMergeRunner: PullRequestMergeRunner,
		private readonly gitStorageClient: GitStorageClient,
		private readonly gitHubWriteThroughService: GitHubWriteThroughService
	) {}

	async reconcileGitHubPullRequests({
		actorIds,
		pendingEvents,
		pullRequests,
		repositoryId,
	}: {
		actorIds: Map<string, GitHubActorId>
		pendingEvents: GitHubPendingPullRequestEvent[]
		pullRequests: GitHubSyncPullRequest[]
		repositoryId: RepositoryId
	}): Promise<void> {
		const computedAt = new Date()

		for (const pullRequest of pullRequests) {
			const authorActorId = actorIds.get(pullRequest.author.nodeId)
			const mergedByActorId = pullRequest.mergedBy
				? actorIds.get(pullRequest.mergedBy.nodeId)
				: undefined

			if (!authorActorId)
				throw new Error('synchronized pull request author mapping is missing')

			const reconciled =
				await this.pullRequestsRepository.reconcileGitHubPullRequest({
					repositoryId,
					pullRequest,
					authorActorId,
					mergedByActorId,
					pendingEvents: pendingEvents.filter(
						event => event.subjectNumber === pullRequest.number
					),
				})

			const { additions, changedFiles, commitCount, deletions } = pullRequest

			// GitHub reported the totals, so the list shows a diff before anyone opens it.
			if (
				additions !== undefined &&
				deletions !== undefined &&
				changedFiles !== undefined
			)
				await this.pullRequestsRepository.writeDiffStats({
					pullRequestId: reconciled.id,
					baseSha: pullRequest.baseSha,
					headSha: pullRequest.headSha,
					additions,
					deletions,
					changedFiles,
					commitCount,
					computedAt,
				})
			else if (reconciled.comparisonChanged)
				await this.pullRequestsRepository.clearDiffStats(reconciled.id)
		}
	}

	async create(
		userId: UserId,
		{
			body,
			slug,
			sourceBranch,
			targetBranch,
			title,
			username,
		}: ParsedCreatePullRequestInput
	): Promise<PullRequest> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const refs = await this.gitStorageClient.listRepositoryRefs({
			repositoryId,
			storagePath,
			trustedGpgKeys: [],
		})
		const sourceRef = refs.branches.find(branch => branch.name === sourceBranch)
		const targetRef = refs.branches.find(branch => branch.name === targetBranch)

		if (!(sourceRef && targetRef))
			throw new PullRequestInvalidBranchesError({
				repositoryId,
				sourceBranch,
				targetBranch,
				missingSourceBranch: !sourceRef,
				missingTargetBranch: !targetRef,
			})

		if (sourceRef.target === targetRef.target)
			throw new PullRequestNoChangesError({
				repositoryId,
				sourceBranch,
				targetBranch,
			})

		try {
			const pullRequest = await this.pullRequestsRepository.create({
				repositoryId,
				authorUserId: userId,
				sourceBranch,
				targetBranch,
				openingBaseSha: targetRef.target,
				openingHeadSha: sourceRef.target,
				title,
				body: body ?? '',
			})

			if (!pullRequest)
				throw new PullRequestNotFoundError({
					repositoryId,
				})

			const diffStats = await this.refreshDiffStats({
				baseRef: targetBranch,
				headRef: sourceBranch,
				pullRequestId: pullRequest.id,
				repositoryId,
				storagePath,
			})

			return { ...toPullRequestOutput(pullRequest, username), diffStats }
		} catch (error) {
			if (isUniqueViolation(error, OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT))
				throw new PullRequestAlreadyOpenError({
					repositoryId,
					sourceBranch,
					targetBranch,
				})

			throw error
		}
	}

	async list(
		viewerUserId: UserId | undefined,
		{
			cursor,
			direction,
			draft,
			limit,
			q,
			slug,
			sort,
			state,
			username,
		}: ParsedListPullRequestsInput
	): Promise<ListPullRequestsResult> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const ordering = { sort, direction }
		const { hasAnyPullRequests, hasMore, pullRequests } =
			await this.pullRequestsRepository.list({
				repositoryId,
				state,
				draft,
				q,
				...ordering,
				limit,
				cursor: cursor ? decodePullRequestCursor(cursor, ordering) : undefined,
			})
		// Review staleness and check rollups both hang off the head each row points
		// at, so the page resolves heads once and both summaries read from it.
		const headRefs = await this.pullRequestHeadResolver.listHeadRefs({
			pullRequests,
			repositoryId,
			storagePath,
		})
		const [reviewSummaries, checksSummaries] = await Promise.all([
			this.pullRequestReviewsService.listReviewSummaries({
				headRefs,
				pullRequests,
			}),
			this.checksReadService.listSummaries({
				heads: [...headRefs].map(([key, head]) => ({ ...head, key })),
				repositoryId,
			}),
		])

		const lastPullRequest = pullRequests.at(-1)

		return {
			pullRequests: pullRequests.map(pullRequest => ({
				...toPullRequestOutput(pullRequest, username),
				reviewSummary:
					reviewSummaries.get(pullRequest.id) ?? EMPTY_REVIEW_SUMMARY,
				checksSummary: checksSummaries.get(pullRequest.id),
			})),
			nextCursor:
				hasMore && lastPullRequest
					? encodePullRequestCursor(
							{
								value: lastPullRequest.sortValue,
								number: lastPullRequest.number,
							},
							ordering
						)
					: undefined,
			hasAnyPullRequests,
			authority: toPullRequestAuthority(tesseraWritesAllowed),
			viewerRole,
		}
	}

	async get(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	) {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const [events, reviewState, checksSummary, mergeQueue] = await Promise.all([
			this.pullRequestsRepository.listEvents({
				pullRequestId: pullRequest.id,
			}),
			this.pullRequestReviewsService.getReviewState({
				pullRequest,
				repositoryId,
				storagePath,
				viewerRole,
				viewerUserId,
			}),
			this.findChecksSummary({ pullRequest, repositoryId, storagePath }),
			this.mergeQueueStatusService.getStatus({
				pullRequestId: pullRequest.id,
				repositoryId,
			}),
		])

		return {
			pullRequest: toPullRequestOutput(pullRequest, username),
			events: events.map(event => toPullRequestEventOutput(event, username)),
			...reviewState,
			checksSummary,
			mergeQueue,
			authority: toPullRequestAuthority(tesseraWritesAllowed),
			viewerRole,
		}
	}

	/**
	 * Every result reported on the pull request's head, for the detail panel that
	 * refreshes on its own.
	 */
	async listChecks(
		viewerUserId: UserId | undefined,
		{
			expectedHeadSha,
			number,
			slug,
			username,
		}: ParsedListPullRequestChecksInput
	): Promise<ChecksList> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const [head, rule] = await Promise.all([
			this.pullRequestHeadResolver.resolveHeadRef({
				pullRequest,
				repositoryId,
				storagePath,
			}),
			this.branchProtectionService.findRuleForBranch({
				repositoryId,
				targetBranch: pullRequest.targetBranch,
			}),
		])

		// The caller names the commit it is about to render these rows beside, so
		// the answer describes that commit even when the head has moved on since —
		// and says so through `headIsCurrent` rather than by quietly answering
		// about a different commit than the one asked about.
		//
		// The target branch's rule travels with it because a requirement nothing
		// reported on has no row of its own to appear in, and an absent gate is
		// exactly what a reader most needs the panel to name.
		return await this.checksReadService.listChecks({
			head: {
				sha: expectedHeadSha,
				isCurrent: head.isCurrent && head.sha === expectedHeadSha,
			},
			repositoryId,
			requiredContexts: rule?.requiredCheckContexts,
		})
	}

	async comparison(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestComparison> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)
		const computedAt = new Date()

		const comparison = await this.gitStorageClient.compareRepositoryRefs({
			repositoryId,
			storagePath,
			baseRef,
			headRef,
		})

		await this.repairDiffStats(pullRequest, comparison, computedAt)

		return await this.toComparisonOutput(repositoryId, comparison)
	}

	/**
	 * What the current head holds that the reviewed commit did not. The pull
	 * request's own comparison is resolved first so the reviewed commit is
	 * compared against the head the files view is showing, and so a missing
	 * object on the second call can only be the reviewed one.
	 */
	async reviewComparison(
		viewerUserId: UserId | undefined,
		{
			number,
			reviewId,
			slug,
			username,
		}: ParsedGetPullRequestReviewComparisonInput
	): Promise<PullRequestReviewComparison> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const review = await this.findReviewComparisonContext(
			pullRequest.id,
			reviewId
		)
		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)
		const computedAt = new Date()
		const canonical = await this.gitStorageClient.compareRepositoryRefs({
			repositoryId,
			storagePath,
			baseRef,
			headRef,
		})
		const context = {
			review,
			canonicalBaseSha: canonical.baseSha,
			currentHeadSha: canonical.headSha,
		}

		await this.repairDiffStats(pullRequest, canonical, computedAt)

		if (review.headSha === canonical.headSha)
			return { status: 'nothing_new', ...context }

		const comparison = await this.compareReviewedHead({
			currentHeadSha: canonical.headSha,
			repositoryId,
			reviewHeadSha: review.headSha,
			storagePath,
		})

		if (!comparison) return { status: 'review_head_unavailable', ...context }

		return {
			status: 'ready',
			...context,
			// The reviewed commit stops being the merge base once history is
			// rewritten under it, which is what makes rebased changes reappear here.
			historiesDiverged: comparison.mergeBaseSha !== review.headSha,
			comparison: await this.toComparisonOutput(repositoryId, comparison),
		}
	}

	async fileDiff(
		viewerUserId: UserId | undefined,
		{
			expectedBaseSha,
			expectedHeadSha,
			number,
			path,
			slug,
			username,
		}: ParsedGetPullRequestFileDiffInput
	): Promise<PullRequestFileDiff> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		await this.findPullRequest(repositoryId, number)
		const diff = await this.gitStorageClient.getRepositoryFileDiff({
			repositoryId,
			storagePath,
			baseRef: expectedBaseSha,
			headRef: expectedHeadSha,
			path,
		})
		const [baseBlob, headBlob] = await Promise.all([
			this.getDiffBlob(repositoryId, storagePath, diff.file.baseBlobId),
			this.getDiffBlob(repositoryId, storagePath, diff.file.headBlobId),
		])

		return await highlightPullRequestDiff({ diff, baseBlob, headBlob })
	}

	/**
	 * The lines around a hunk, taken from the blob the diff already resolved.
	 *
	 * One side is served at a time: within an unchanged gap the two sides are the
	 * same text, and expanding across a region where they are not aligned is the
	 * caller's own arithmetic, not something the file can answer.
	 */
	async fileLines(
		viewerUserId: UserId | undefined,
		{
			endLine,
			expectedBaseSha,
			expectedHeadSha,
			number,
			path,
			side,
			slug,
			startLine,
			username,
		}: ParsedGetPullRequestFileLinesInput
	): Promise<PullRequestFileLines> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		await this.findPullRequest(repositoryId, number)
		const diff = await this.getExpandableFileDiff({
			expectedBaseSha,
			expectedHeadSha,
			number,
			path,
			repositoryId,
			storagePath,
		})
		const blobId = side === 'left' ? diff.file.baseBlobId : diff.file.headBlobId
		const blob = await this.getDiffBlob(repositoryId, storagePath, blobId)

		if (blob?.preview.type !== 'text')
			throw new PullRequestFileContentNotFoundError({
				number,
				path,
				preview: blob?.preview.type,
				repositoryId,
				side,
			})

		return await highlightPullRequestFileLines({
			content: blob.preview.content,
			endLine,
			objectId: blob.objectId,
			path: side === 'left' ? diff.file.oldPath : diff.file.newPath,
			sha: side === 'left' ? diff.mergeBaseSha : diff.headSha,
			side,
			startLine,
		})
	}

	/** The commits the caller is looking at are what the expansion is resolved against; once they are gone there is nothing to expand. */
	private async getExpandableFileDiff({
		expectedBaseSha,
		expectedHeadSha,
		number,
		path,
		repositoryId,
		storagePath,
	}: {
		expectedBaseSha: string
		expectedHeadSha: string
		number: number
		path: string
		repositoryId: RepositoryId
		storagePath: string
	}) {
		try {
			return await this.gitStorageClient.getRepositoryFileDiff({
				repositoryId,
				storagePath,
				baseRef: expectedBaseSha,
				headRef: expectedHeadSha,
				path,
			})
		} catch (error) {
			if (isMissingGitObjectError(error))
				throw new PullRequestStaleComparisonError({
					number,
					path,
					repositoryId,
				})

			throw error
		}
	}

	async edit(
		userId: UserId,
		{ body, number, slug, title, username }: ParsedEditPullRequestInput
	): Promise<PullRequest> {
		const { gitHubTarget, repositoryId } =
			await this.repositoriesService.getPullRequestWriteContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestEditable(pullRequest)

		const writeThrough = toGitHubWriteThroughContext(userId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})

		if (writeThrough)
			return await this.updateThroughGitHub(writeThrough, {
				body,
				number,
				repositoryId,
				title,
				username,
			})

		const updatedPullRequest = await this.pullRequestsRepository.edit({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			expectedState: pullRequest.state,
			title,
			body,
		})

		return toPullRequestOutput(
			this.requireUpdatedPullRequest(updatedPullRequest, pullRequest, 'edit'),
			username
		)
	}

	/**
	 * Moves an open pull request onto another target branch.
	 *
	 * Only the target moves. The source is what the pull request is — push
	 * routing, head resolution and every review anchored to that history all read
	 * it — so changing it would make the pull request a different one under the
	 * same number.
	 *
	 * Nothing that was written down is rewritten: the opening SHAs stay the
	 * creation facts they are, and the comparison, the protection rule and the
	 * required contexts are all resolved from the live target on the next read. A
	 * consequence worth stating is that inline threads become outdated against the
	 * new base while approvals, which are judged on the head alone, do not.
	 */
	async retarget(
		userId: UserId,
		{ number, slug, targetBranch, username }: ParsedRetargetPullRequestInput
	): Promise<PullRequest> {
		const { gitHubTarget, repositoryId, storagePath, tesseraWritesAllowed } =
			await this.repositoriesService.getPullRequestWriteContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestRetargetable(pullRequest)

		const writeThrough = toGitHubWriteThroughContext(userId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})

		if (writeThrough)
			return await this.updateThroughGitHub(writeThrough, {
				number,
				repositoryId,
				targetBranch,
				username,
			})

		// Asking for the target it already has is not a change. Nothing is written
		// and nothing is recorded, so a retried request cannot leave a timeline
		// claiming the branch moved to where it already was.
		if (pullRequest.targetBranch === targetBranch)
			return toPullRequestOutput(pullRequest, username)

		if (pullRequest.sourceBranch === targetBranch)
			throw new PullRequestInvalidBranchesError(
				{
					repositoryId,
					sourceBranch: pullRequest.sourceBranch,
					targetBranch,
				},
				'The source and target branches must be different.'
			)

		const refs = await this.gitStorageClient.listRepositoryRefs({
			repositoryId,
			storagePath,
			trustedGpgKeys: [],
		})
		const sourceRef = refs.branches.find(
			branch => branch.name === pullRequest.sourceBranch
		)
		const targetRef = refs.branches.find(branch => branch.name === targetBranch)

		if (!(sourceRef && targetRef))
			throw new PullRequestInvalidBranchesError({
				repositoryId,
				sourceBranch: pullRequest.sourceBranch,
				targetBranch,
				missingSourceBranch: !sourceRef,
				missingTargetBranch: !targetRef,
			})

		if (sourceRef.target === targetRef.target)
			throw new PullRequestNoChangesError({
				repositoryId,
				sourceBranch: pullRequest.sourceBranch,
				targetBranch,
			})

		const retargeted = await this.underRepositoryMergeLease({
			repositoryId,
			toUnavailableError: () =>
				new RepositoryMergeInProgressError({ repositoryId }),
			run: async leaseOwner =>
				await this.retargetUnderMergeLease({
					actorUserId: userId,
					leaseOwner,
					pullRequest,
					repositoryId,
					storagePath,
					targetBranch,
					tesseraWritesAllowed,
				}),
		})

		await this.pullRequestsRepository.clearDiffStats(retargeted.id)

		const diffStats = await this.refreshDiffStats({
			baseRef: retargeted.targetBranch,
			headRef: retargeted.sourceBranch,
			pullRequestId: retargeted.id,
			repositoryId,
			storagePath,
		})

		return { ...toPullRequestOutput(retargeted, username), diffStats }
	}

	/**
	 * The half of retargeting that needs the repository to itself: an abandoned
	 * attempt may already have merged this pull request onto the target being
	 * moved away from, and only recovery can say so.
	 *
	 * The lease is still held when the write commits, which is what stops a merge
	 * from being cleared against one target and made against another: a merge that
	 * starts after this returns re-resolves everything from the branch it now
	 * reads.
	 */
	private async retargetUnderMergeLease({
		actorUserId,
		leaseOwner,
		pullRequest,
		repositoryId,
		storagePath,
		targetBranch,
		tesseraWritesAllowed,
	}: {
		actorUserId: UserId
		leaseOwner: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
		targetBranch: string
		tesseraWritesAllowed: boolean
	}): Promise<PullRequestEntity> {
		const merged = await this.recoverAbandonedMerge({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			username: pullRequest.authorUsername ?? '',
		})

		if (merged)
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: 'merged',
				action: 'retarget',
			})

		const result = await this.writeRetarget({
			actorUserId,
			leaseOwner,
			pullRequest,
			repositoryId,
			targetBranch,
		})

		switch (result.status) {
			// An identical request got there first, which is a retry succeeding
			// rather than a conflict.
			case 'retargeted':
			case 'unchanged':
				return result.pullRequest
			case 'lease_lost':
				throw new RepositoryMergeInProgressError({ repositoryId })
			case 'merge_in_progress':
				throw new PullRequestMergeInProgressError({
					pullRequestId: pullRequest.id,
				})
			case 'queued':
				throw new PullRequestQueuedError(result.queueState, {
					pullRequestId: pullRequest.id,
				})
			default:
				throw new PullRequestStateConflictError({
					pullRequestId: pullRequest.id,
					state: pullRequest.state,
					action: 'retarget',
				})
		}
	}

	/**
	 * The write itself, with the open-pair index reported as the conflict it is:
	 * somebody already has a pull request open between these two branches.
	 */
	private async writeRetarget({
		actorUserId,
		leaseOwner,
		pullRequest,
		repositoryId,
		targetBranch,
	}: {
		actorUserId: UserId
		leaseOwner: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		targetBranch: string
	}): Promise<RetargetPullRequestResult> {
		try {
			return await this.pullRequestsRepository.retarget({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId,
				expectedTargetBranch: pullRequest.targetBranch,
				leaseOwner,
				targetBranch,
			})
		} catch (error) {
			if (isUniqueViolation(error, OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT))
				throw new PullRequestAlreadyOpenError({
					repositoryId,
					sourceBranch: pullRequest.sourceBranch,
					targetBranch,
				})

			throw error
		}
	}

	async close(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequest> {
		const { gitHubTarget, repositoryId, storagePath, tesseraWritesAllowed } =
			await this.repositoriesService.getPullRequestWriteContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestClosable(pullRequest)

		const writeThrough = toGitHubWriteThroughContext(userId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})

		if (writeThrough)
			return await this.updateThroughGitHub(writeThrough, {
				number,
				repositoryId,
				state: 'closed',
				username,
			})
		// An abandoned attempt may already have merged this pull request in Git.
		// Closing it would delete the only record of that, so the intent is
		// resolved first — and a pull request that turns out to be merged is no
		// longer closable.
		await this.resolveAbandonedMergeBeforeClose({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
		})
		const changedAt = new Date()

		// Closing takes this pull request's queue entry with it, in the same
		// transaction. Whatever was waiting behind it is woken by the reconciler
		// rather than from here: a repository with entries and nothing running them
		// is exactly what that pass looks for, and reaching Redis from this module
		// would mean every caller of it booting a merge worker to close a pull
		// request.
		const closedPullRequest = await this.pullRequestsRepository.close({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			changedAt,
			staleBefore: new Date(changedAt.getTime() - MERGE_INTENT_LEASE_MS),
		})
		const closed = this.requireUpdatedPullRequest(
			closedPullRequest,
			pullRequest,
			'close'
		)

		return toPullRequestOutput(closed, username)
	}

	async reopen(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequest> {
		const { gitHubTarget, repositoryId } =
			await this.repositoriesService.getPullRequestWriteContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestReopenable(pullRequest)

		const writeThrough = toGitHubWriteThroughContext(userId, {
			gitHubTarget,
			pullRequestId: pullRequest.id,
			repositoryId,
		})

		if (writeThrough)
			return await this.updateThroughGitHub(writeThrough, {
				number,
				repositoryId,
				state: 'open',
				username,
			})

		try {
			const reopenedPullRequest = await this.pullRequestsRepository.reopen({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: userId,
				changedAt: new Date(),
			})

			return toPullRequestOutput(
				this.requireUpdatedPullRequest(
					reopenedPullRequest,
					pullRequest,
					'reopen'
				),
				username
			)
		} catch (error) {
			if (isUniqueViolation(error, OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT))
				throw new PullRequestAlreadyOpenError({
					repositoryId,
					sourceBranch: pullRequest.sourceBranch,
					targetBranch: pullRequest.targetBranch,
				})

			throw error
		}
	}

	/**
	 * Whether this pull request may be merged right now. Advisory: the merge
	 * itself never trusts this answer and always re-evaluates, so nothing is
	 * audited here — the timeline records decisions, and a question is not one.
	 */
	async getMergeRequirements(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<MergeRequirements> {
		const {
			gitHubTarget,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			viewerRole,
		} = await this.repositoriesService.getReadableRepositoryContext(
			viewerUserId,
			{
				username,
				slug,
			}
		)
		const pullRequest = await this.findPullRequest(repositoryId, number)

		// GitHub judges a mirrored merge at the merge, so Tessera evaluates nothing.
		if (gitHubTarget) return toGitHubMergeRequirements(pullRequest, viewerRole)

		return await this.mergeRequirementsService.evaluate({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			viewerRole,
		})
	}

	/**
	 * Merges, or explains why it will not.
	 *
	 * Governance is enforced here rather than inferred from whatever the client
	 * last read: the repository lease is taken first so no other merge can move
	 * the target underneath this one, every requirement is then evaluated afresh,
	 * and Git is called with the SHAs that evaluation resolved. A blocked attempt
	 * is a result rather than a failure — the caller asked whether this merge may
	 * happen and gets the complete answer.
	 */
	async merge(
		actor: PullRequestMergeActor,
		input: ParsedMergePullRequestInput
	): Promise<MergePullRequestResult> {
		const { bypass, expectedBaseSha, expectedHeadSha, number, slug, username } =
			input
		const {
			gitHubTarget,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			viewerRole,
		} = await this.repositoriesService.getReadableRepositoryContext(actor.id, {
			username,
			slug,
		})

		if (gitHubTarget)
			return await this.mergeThroughGitHub({
				actor,
				gitHubTarget,
				input,
				repositoryId,
				viewerRole,
			})

		// Answered before the lease so a caller who could never merge here cannot
		// take the repository from those who can. Nothing is skipped by it: the
		// full evaluation still runs under the lease and reports these same
		// reasons among the rest.
		const authorityReasons = toMergeAuthorityReasons({
			tesseraWritesAllowed,
			viewerRole,
		})

		if (authorityReasons.length > 0)
			return await this.blockBeforeEvaluation({
				actorUserId: actor.id,
				number,
				reasons: authorityReasons,
				repositoryId,
			})

		const leaseOwner = randomUUID()
		const leaseAcquired =
			await this.mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId,
				owner: leaseOwner,
				ttlMs: REPOSITORY_MERGE_LEASE_MS,
			})

		if (!leaseAcquired)
			return await this.blockBeforeEvaluation({
				actorUserId: actor.id,
				number,
				reasons: [{ code: 'repository_merge_in_progress' }],
				repositoryId,
			})

		try {
			return await this.mergeUnderLease({
				actor,
				bypass,
				expected: { baseSha: expectedBaseSha, headSha: expectedHeadSha },
				leaseOwner,
				number,
				repositoryId,
				selection: input,
				storagePath,
				tesseraWritesAllowed,
				username,
				viewerRole,
			})
		} finally {
			// The merge has already happened or already failed by now, and the lease
			// ages out on its own, so a release that will not go through is worth a
			// line in the log and nothing more. Awaiting it as part of the result
			// would let a transient database blip overwrite a committed merge with a
			// failure the caller cannot act on.
			await this.mergeQueueRepository
				.releaseRepositoryMergeLease({ repositoryId, owner: leaseOwner })
				.catch((error: unknown) =>
					this.logger.warn(
						`Failed to release the merge lease on repository ${repositoryId}; it expires in ${REPOSITORY_MERGE_LEASE_MS}ms: ${String(error)}`
					)
				)
		}
	}

	/**
	 * A refusal reached before the requirements could be evaluated at all: the
	 * caller may not merge here, or somebody else holds the repository. It is
	 * still a merge attempt, so it is audited like every other one.
	 *
	 * Such a result deliberately carries no `evaluatedBaseSha`/`evaluatedHeadSha`,
	 * because no refs were resolved and none were judged. That absence, together
	 * with the reason codes — which are only ever authority reasons or
	 * `repository_merge_in_progress` — is how a client tells a refusal reached
	 * before evaluation from one the evaluation itself returned.
	 */
	private async blockBeforeEvaluation({
		actorUserId,
		number,
		reasons,
		repositoryId,
	}: {
		actorUserId: UserId
		number: number
		reasons: MergeBlockingReason[]
		repositoryId: RepositoryId
	}): Promise<MergePullRequestResult> {
		const pullRequest = await this.findPullRequest(repositoryId, number)

		return await this.recordUnevaluatedBlock({
			actorUserId,
			pullRequestId: pullRequest.id,
			reasons,
		})
	}

	private async recordUnevaluatedBlock({
		actorUserId,
		pullRequestId,
		reasons,
	}: {
		actorUserId: UserId
		pullRequestId: PullRequestId
		reasons: MergeBlockingReason[]
	}): Promise<MergePullRequestResult> {
		await this.pullRequestsRepository.recordMergeBlocked({
			pullRequestId,
			actorUserId,
			payload: { reasonCodes: reasons.map(reason => reason.code) },
		})

		return {
			status: 'blocked',
			requirements: { eligible: false, canBypass: false, reasons },
		}
	}

	private async mergeUnderLease({
		actor,
		bypass,
		expected,
		leaseOwner,
		number,
		repositoryId,
		selection,
		storagePath,
		tesseraWritesAllowed,
		username,
		viewerRole,
	}: MergeUnderLeaseParams): Promise<MergePullRequestResult> {
		const pullRequest = await this.findPullRequest(repositoryId, number)

		if (pullRequest.state === 'merged' && pullRequest.mergeCommitSha)
			return {
				status: 'merged',
				pullRequest: toPullRequestOutput(pullRequest, username),
			}

		const recovered = await this.recoverAbandonedMerge({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
			username,
		})

		if (recovered) return recovered

		const requirements = await this.mergeRequirementsService.evaluate({
			expected,
			leaseOwner,
			pullRequest,
			repositoryId,
			storagePath,
			strategy: selection.strategy,
			tesseraWritesAllowed,
			viewerRole,
		})
		const bypassContext = toMergeBypassContext(requirements, bypass)

		if (!(requirements.eligible || bypassContext)) {
			await this.pullRequestsRepository.recordMergeBlocked({
				pullRequestId: pullRequest.id,
				actorUserId: actor.id,
				payload: {
					ruleId: requirements.rule?.id,
					ruleVersion: requirements.rule?.version,
					reasonCodes: requirements.reasons.map(reason => reason.code),
					baseSha: requirements.evaluatedBaseSha,
					headSha: requirements.evaluatedHeadSha,
				},
			})

			return { status: 'blocked', requirements }
		}

		// Evaluation resolved the refs this merge is judged against, so those are
		// the ones Git is asked to compare and swap on. A SHA the client supplied
		// could name a commit the evaluation never saw.
		const { evaluatedBaseSha, evaluatedHeadSha } = requirements

		if (!(evaluatedBaseSha && evaluatedHeadSha))
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'merge',
			})

		const attempt = await this.pullRequestMergeRunner.run({
			actor,
			bypass: bypassContext,
			leaseOwner,
			pullRequest,
			repositoryId,
			request: toPullRequestMergeRequest({
				evaluatedBaseSha,
				evaluatedHeadSha,
				pullRequest,
				selection,
			}),
			storagePath,
		})

		switch (attempt.outcome) {
			case 'merged':
				return {
					status: 'merged',
					pullRequest: toPullRequestOutput(attempt.pullRequest, username),
				}
			// Somebody else took the repository while this attempt was being
			// evaluated, which is the same refusal as finding it taken to begin with.
			case 'lease_lost':
				return await this.recordUnevaluatedBlock({
					actorUserId: actor.id,
					pullRequestId: pullRequest.id,
					reasons: [{ code: 'repository_merge_in_progress' }],
				})
			// Git compared and swapped against the refs this evaluation resolved and
			// refused. That is the authoritative answer about the same world the
			// requirements described, so it comes back as a refusal of the merge
			// rather than as a fault: an error here would leave the strongest verdict
			// of all — the one the merge itself got — out of the audit trail.
			case 'refs_moved':
				return await this.blockAfterRefusal({
					actor,
					expected: {
						baseSha: evaluatedBaseSha,
						headSha: evaluatedHeadSha,
					},
					leaseOwner,
					pullRequest,
					repositoryId,
					storagePath,
					strategy: selection.strategy,
					tesseraWritesAllowed,
					toFallbackReasons: fresh => [
						toRefusedMergeReason({
							fresh,
							kind: attempt.kind,
							triedBaseSha: evaluatedBaseSha,
							triedHeadSha: evaluatedHeadSha,
						}),
					],
					viewerRole,
				})
			default:
				return await this.blockAfterRefusal({
					actor,
					leaseOwner,
					pullRequest,
					repositoryId,
					storagePath,
					strategy: selection.strategy,
					tesseraWritesAllowed,
					toFallbackReasons: () => [toStateConflictReason(attempt.state)],
					viewerRole,
				})
		}
	}

	/**
	 * Settles any abandoned merge intent before the pull request is closed.
	 *
	 * Closing deletes the intent, and the intent is the only thing that says
	 * which merge an abandoned attempt was making. If Git carried that merge out,
	 * deleting it would leave a closed pull request whose target branch had moved
	 * and nothing anywhere recording why — so the merge is recorded instead, and
	 * the close then fails as it would for any merged pull request.
	 *
	 * The repository lease is taken for the same reason merging takes it: the
	 * recovery completes a merge, and nothing else may be moving the same
	 * repository while it does.
	 */
	private async resolveAbandonedMergeBeforeClose({
		pullRequest,
		repositoryId,
		storagePath,
		tesseraWritesAllowed,
	}: {
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
		tesseraWritesAllowed: boolean
	}): Promise<void> {
		await this.underRepositoryMergeLease({
			repositoryId,
			// Somebody is merging this repository right now. Their attempt owns the
			// intent, and the close is refused rather than racing it.
			toUnavailableError: () =>
				new PullRequestStateConflictError({
					pullRequestId: pullRequest.id,
					state: pullRequest.state,
					action: 'close',
				}),
			run: async () => {
				const merged = await this.recoverAbandonedMerge({
					pullRequest,
					repositoryId,
					storagePath,
					tesseraWritesAllowed,
					username: pullRequest.authorUsername ?? '',
				})

				if (merged)
					throw new PullRequestStateConflictError({
						pullRequestId: pullRequest.id,
						state: 'merged',
						action: 'close',
					})
			},
		})
	}

	/**
	 * Runs something with the repository's merge lease held for its whole
	 * duration, and hands the lease back however it ends.
	 *
	 * Not taking it means another merge owns this repository, which is the
	 * caller's refusal to report rather than a fault — what that refusal should
	 * say differs by what was being attempted, so the caller supplies it.
	 */
	private async underRepositoryMergeLease<T>({
		repositoryId,
		run,
		toUnavailableError,
	}: {
		repositoryId: RepositoryId
		run: (leaseOwner: string) => Promise<T>
		toUnavailableError: () => Error
	}): Promise<T> {
		const leaseOwner = randomUUID()
		const leaseAcquired =
			await this.mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId,
				owner: leaseOwner,
				ttlMs: REPOSITORY_MERGE_LEASE_MS,
			})

		if (!leaseAcquired) throw toUnavailableError()

		try {
			return await run(leaseOwner)
		} finally {
			await this.mergeQueueRepository
				.releaseRepositoryMergeLease({ repositoryId, owner: leaseOwner })
				.catch((error: unknown) =>
					this.logger.warn(
						`Failed to release the merge lease on repository ${repositoryId}; it expires in ${REPOSITORY_MERGE_LEASE_MS}ms: ${String(error)}`
					)
				)
		}
	}

	/**
	 * Finishes recording a merge an earlier attempt made and never wrote down.
	 *
	 * A process can die between Git returning and the completion committing, and
	 * the target is then somewhere a fresh evaluation reads as staleness — so this
	 * runs first, before anything is judged again.
	 *
	 * It records; it never merges. Git is asked only whether the operation left a
	 * receipt, which is a read that moves nothing. An abandoned attempt that never
	 * reached Git — the service was unreachable, the deadline passed, the process
	 * died before the call — has no receipt, and replaying it would be performing
	 * a merge on the strength of an evaluation nobody has repeated, under an actor
	 * and a waiver it inherited. Those intents are released instead, and the merge
	 * is decided again from scratch like any other.
	 */
	private async recoverAbandonedMerge({
		pullRequest,
		repositoryId,
		storagePath,
		tesseraWritesAllowed,
		username,
	}: {
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
		tesseraWritesAllowed: boolean
		username: string
	}): Promise<MergePullRequestResult | undefined> {
		// A repository GitHub has taken over is no longer Tessera's to record
		// merges on; its pull request state is reconciled from the provider.
		if (!tesseraWritesAllowed) return undefined

		const intent = await this.pullRequestsRepository.findRecoverableMergeIntent(
			{
				pullRequestId: pullRequest.id,
				staleBefore: new Date(Date.now() - MERGE_INTENT_LEASE_MS),
			}
		)

		if (!intent) return undefined

		const merged = await this.completeRecoveredMerge({
			intent,
			pullRequest,
			repositoryId,
			storagePath,
		})

		return (
			merged && {
				status: 'merged',
				pullRequest: toPullRequestOutput(merged, username),
			}
		)
	}

	/**
	 * The half of recovery both merge paths share: ask Git whether the operation
	 * left a receipt, record the merge it describes, and hand back the abandoned
	 * intent when it did not.
	 */
	private async completeRecoveredMerge({
		intent,
		pullRequest,
		queueEntryId,
		repositoryId,
		storagePath,
	}: {
		intent: RecoverableMergeIntent
		pullRequest: PullRequestReadModel
		queueEntryId?: MergeQueueEntryId
		repositoryId: RepositoryId
		storagePath: string
	}): Promise<PullRequestEntity | undefined> {
		const resultingSha =
			intent.request &&
			(await this.gitStorageClient.findMergeReceipt({
				repositoryId,
				storagePath,
				// The same identifier every attempt at this merge has used, which is
				// what git storage files its receipt under.
				operationId: pullRequest.id,
				strategy: intent.request.strategy,
				expectedBaseSha: intent.request.expectedBaseSha,
				expectedHeadSha: intent.request.expectedHeadSha,
			}))

		// An intent written before requests were recorded — which the strategies
		// migration deliberately left in place rather than requiring a quiesce —
		// cannot be looked up and cannot be replayed. Releasing it hands the merge
		// back to a fresh evaluation, and the bounded legacy trailer scan is what
		// still stops a pre-receipt merge_commit from being made twice.
		if (!resultingSha) {
			this.logger.log(
				`Releasing the abandoned merge intent of pull request ${pullRequest.id}; git storage has no receipt for it`
			)
			await this.pullRequestsRepository.releaseMerge({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: intent.actor.id,
				attemptId: intent.attemptId,
			})

			return undefined
		}

		this.logger.log(
			`Recording the abandoned merge of pull request ${pullRequest.id}, which git storage had already made`
		)

		return await this.pullRequestsRepository.completeMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: intent.actor.id,
			attemptId: intent.attemptId,
			changedAt: new Date(),
			resultingSha,
			queueEntryId,
		})
	}

	/**
	 * Re-reads the requirements after the merge itself was refused, records the
	 * refusal, and hands back what a caller who asked a moment later would see.
	 *
	 * The second evaluation is what makes the answer actionable: Git rejected the
	 * swap because the world moved, so the pair of SHAs this attempt was cleared
	 * with describes a world that no longer exists. When the fresh look finds
	 * nothing to report — the refs moved back, or another attempt is finishing the
	 * same merge — what Git objected to is recorded from what this attempt knew.
	 *
	 * The evaluation runs under this attempt's own lease, so the hold it took
	 * itself is not reported back to it as a reason nobody can act on.
	 */
	private async blockAfterRefusal({
		actor,
		expected,
		leaseOwner,
		pullRequest,
		repositoryId,
		storagePath,
		strategy,
		tesseraWritesAllowed,
		toFallbackReasons,
		viewerRole,
	}: {
		actor: PullRequestMergeActor
		expected?: { baseSha: string; headSha: string }
		leaseOwner: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
		strategy?: MergeStrategy
		tesseraWritesAllowed: boolean
		toFallbackReasons: (fresh: MergeRequirements) => MergeBlockingReason[]
		viewerRole?: RepositoryRole
	}): Promise<MergePullRequestResult> {
		const current = await this.findPullRequest(repositoryId, pullRequest.number)
		const evaluated = await this.mergeRequirementsService.evaluate({
			expected,
			leaseOwner,
			pullRequest: current,
			repositoryId,
			storagePath,
			strategy,
			tesseraWritesAllowed,
			viewerRole,
		})
		const requirements: MergeRequirements =
			evaluated.reasons.length > 0
				? evaluated
				: {
						...evaluated,
						eligible: false,
						reasons: toFallbackReasons(evaluated),
					}

		await this.pullRequestsRepository.recordMergeBlocked({
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			payload: {
				ruleId: requirements.rule?.id,
				ruleVersion: requirements.rule?.version,
				reasonCodes: requirements.reasons.map(reason => reason.code),
				baseSha: requirements.evaluatedBaseSha,
				headSha: requirements.evaluatedHeadSha,
			},
		})

		return { status: 'blocked', requirements }
	}

	/** The timeline entry is left to the delivery, which is what can key it. */
	private async updateThroughGitHub(
		writeThrough: GitHubWriteThroughContext,
		{
			body,
			number,
			repositoryId,
			state,
			targetBranch,
			title,
			username,
		}: {
			body?: string
			number: number
			repositoryId: RepositoryId
			state?: 'open' | 'closed'
			targetBranch?: string
			title?: string
			username: string
		}
	): Promise<PullRequest> {
		await this.gitHubWriteThroughService.updatePullRequest(writeThrough, {
			body,
			state,
			targetBranch,
			title,
		})

		return toPullRequestOutput(
			await this.findPullRequest(repositoryId, number),
			username
		)
	}

	/** No lease, requirements or Git storage: they all describe refs GitHub owns. */
	private async mergeThroughGitHub({
		actor,
		gitHubTarget,
		input,
		repositoryId,
		viewerRole,
	}: {
		actor: PullRequestMergeActor
		gitHubTarget: GitHubWriteThroughTarget
		input: ParsedMergePullRequestInput
		repositoryId: RepositoryId
		viewerRole?: RepositoryRole
	}): Promise<MergePullRequestResult> {
		const { expectedHeadSha, number, strategy, username } = input
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const reasons = toMirroredMergeReasons(pullRequest, viewerRole)

		if (reasons.length > 0)
			return await this.recordUnevaluatedBlock({
				actorUserId: actor.id,
				pullRequestId: pullRequest.id,
				reasons,
			})

		await this.gitHubWriteThroughService.mergePullRequest(
			{
				actorUserId: actor.id,
				externalRepository: gitHubTarget,
				pullRequestId: pullRequest.id,
				repositoryId,
			},
			{ expectedHeadSha, strategy }
		)

		return {
			status: 'merged',
			pullRequest: toPullRequestOutput(
				await this.findPullRequest(repositoryId, number),
				username
			),
		}
	}

	private async refreshDiffStats({
		baseRef,
		headRef,
		pullRequestId,
		repositoryId,
		storagePath,
	}: {
		baseRef: string
		headRef: string
		pullRequestId: PullRequestId
		repositoryId: RepositoryId
		storagePath: string
	}): Promise<PullRequestDiffStats | undefined> {
		const computedAt = new Date()

		try {
			const comparison = await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef,
				headRef,
			})

			return await this.cacheDiffStats(pullRequestId, comparison, computedAt)
		} catch (error) {
			this.logger.warn(
				`Diff stats for pull request ${pullRequestId} could not be computed`,
				error
			)

			return undefined
		}
	}

	private async repairDiffStats(
		pullRequest: PullRequestReadModel,
		comparison: GitStorageRepositoryComparison,
		computedAt: Date
	): Promise<void> {
		// Synchronized totals are dated by the mapped base, not the merge base.
		const baseIsConfirmed =
			pullRequest.diffStatsBaseSha === comparison.mergeBaseSha ||
			pullRequest.diffStatsBaseSha === pullRequest.github?.baseSha

		if (baseIsConfirmed && pullRequest.diffStatsHeadSha === comparison.headSha)
			return

		try {
			await this.cacheDiffStats(pullRequest.id, comparison, computedAt)
		} catch (error) {
			this.logger.warn(
				`Diff stats for pull request ${pullRequest.id} could not be cached`,
				error
			)
		}
	}

	private async cacheDiffStats(
		pullRequestId: PullRequestId,
		comparison: GitStorageRepositoryComparison,
		computedAt: Date
	): Promise<PullRequestDiffStats | undefined> {
		// A truncated comparison cannot confirm the stored pair, so it retires it.
		if (comparison.isTruncated) {
			await this.pullRequestsRepository.clearDiffStats(pullRequestId)

			return undefined
		}

		// A truncated commit list cannot say how many there really are.
		const commitCount = comparison.commitsTruncated
			? undefined
			: comparison.commits.length
		const diffStats = {
			additions: comparison.files.reduce(
				(total, file) => total + file.additions,
				0
			),
			deletions: comparison.files.reduce(
				(total, file) => total + file.deletions,
				0
			),
			changedFiles: comparison.files.length,
			commits: commitCount,
		}

		await this.pullRequestsRepository.writeDiffStats({
			pullRequestId,
			...diffStats,
			commitCount,
			computedAt,
			// The files are diffed from the merge base, so that is what dates them.
			baseSha: comparison.mergeBaseSha,
			headSha: comparison.headSha,
		})

		return diffStats
	}

	private async findChecksSummary({
		pullRequest,
		repositoryId,
		storagePath,
	}: {
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
	}) {
		const head = await this.pullRequestHeadResolver.resolveHeadRef({
			pullRequest,
			repositoryId,
			storagePath,
		})

		return await this.checksReadService.findSummary({ head, repositoryId })
	}

	/**
	 * Attaches each commit's check rollup. One query for the whole list: a status
	 * dot per row must never cost a request per row.
	 */
	private async toComparisonOutput(
		repositoryId: RepositoryId,
		comparison: GitStorageRepositoryComparison
	): Promise<PullRequestComparison> {
		const checksSummaries = await this.checksReadService.listSummaries({
			heads: comparison.commits.map(commit => ({
				key: commit.sha,
				sha: commit.sha,
				isCurrent: commit.sha === comparison.headSha,
			})),
			repositoryId,
		})

		return {
			...comparison,
			commits: comparison.commits.map(commit => ({
				...commit,
				author: commit.author
					? { ...commit.author, date: new Date(commit.author.date) }
					: undefined,
				checksSummary: checksSummaries.get(commit.sha),
			})),
		}
	}

	/**
	 * The comparison from the reviewed commit to the current head, or nothing
	 * when git storage no longer holds the reviewed commit — which a force-push
	 * followed by object cleanup is enough to cause. Every other failure stays a
	 * failure; only the reviewed commit can be the missing object here, because
	 * the pull request's own comparison already resolved against the same
	 * repository.
	 */
	private async compareReviewedHead({
		currentHeadSha,
		repositoryId,
		reviewHeadSha,
		storagePath,
	}: {
		currentHeadSha: string
		repositoryId: RepositoryId
		reviewHeadSha: string
		storagePath: string
	}): Promise<GitStorageRepositoryComparison | undefined> {
		try {
			return await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef: reviewHeadSha,
				headRef: currentHeadSha,
			})
		} catch (error) {
			if (isMissingGitObjectError(error)) return undefined

			throw error
		}
	}

	private async findReviewComparisonContext(
		pullRequestId: PullRequestId,
		reviewId: PullRequestReviewId
	): Promise<PullRequestReviewComparisonContext> {
		const review = await this.pullRequestReviewsRepository.findReview({
			pullRequestId,
			reviewId,
		})
		const context = review && toPullRequestReviewComparisonContext(review)

		if (!context)
			throw new PullRequestReviewNotFoundError({ pullRequestId, reviewId })

		return context
	}

	private async getDiffBlob(
		repositoryId: RepositoryId,
		storagePath: string,
		objectId: string | undefined
	): Promise<GitStorageRepositoryBlob | undefined> {
		if (!objectId) return undefined

		return await this.gitStorageClient.getRepositoryBlob({
			repositoryId,
			storagePath,
			objectId,
		})
	}

	private async findPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestReadModel> {
		const pullRequest = await this.pullRequestsRepository.find({
			repositoryId,
			number,
		})

		if (!pullRequest)
			throw new PullRequestNotFoundError({ repositoryId, number })

		return pullRequest
	}

	private requireUpdatedPullRequest(
		updatedPullRequest: PullRequestEntity | undefined,
		originalPullRequest: PullRequestEntity,
		action: string
	): PullRequestEntity {
		if (updatedPullRequest) return updatedPullRequest

		throw new PullRequestStateConflictError({
			pullRequestId: originalPullRequest.id,
			state: originalPullRequest.state,
			action,
		})
	}
}

/**
 * What Git objected to, told from the refs the refused attempt was cleared with
 * and whatever the fresh evaluation could still resolve. Only reached when that
 * evaluation has nothing of its own to report.
 */
function toRefusedMergeReason({
	fresh,
	kind,
	triedBaseSha,
	triedHeadSha,
}: {
	fresh: MergeRequirements
	kind: PullRequestMergeRefusal
	triedBaseSha: string
	triedHeadSha: string
}): MergeBlockingReason {
	if (kind.code === 'merge_conflict')
		return {
			code: 'merge_conflict',
			baseSha: triedBaseSha,
			headSha: triedHeadSha,
		}

	if (kind.code === 'merge_strategy_unavailable') return kind

	return {
		code: 'stale_refs',
		expectedBaseSha: triedBaseSha,
		actualBaseSha: fresh.evaluatedBaseSha ?? triedBaseSha,
		expectedHeadSha: triedHeadSha,
		actualHeadSha: fresh.evaluatedHeadSha ?? triedHeadSha,
	}
}

/**
 * A pull request that moved between being evaluated and being claimed. Still
 * open means another attempt holds its merge intent, which is the repository
 * being merged by somebody else under a different name.
 */
function toStateConflictReason(
	state: PullRequestEntity['state']
): MergeBlockingReason {
	return state === 'open'
		? { code: 'repository_merge_in_progress' }
		: { code: 'pull_request_not_open', state }
}

function toGitHubMergeRequirements(
	pullRequest: PullRequestReadModel,
	viewerRole?: RepositoryRole
): MergeRequirements {
	const reasons = toMirroredMergeReasons(pullRequest, viewerRole)

	return {
		eligible: reasons.length === 0,
		canBypass: false,
		reasons,
		evaluatedBaseSha: pullRequest.github?.baseSha,
		evaluatedHeadSha: pullRequest.github?.headSha,
	}
}

/** The only two things Tessera still decides about a merge GitHub will make. */
function toMirroredMergeReasons(
	pullRequest: PullRequestReadModel,
	viewerRole?: RepositoryRole
): MergeBlockingReason[] {
	const reasons = toMergePermissionReasons(viewerRole)

	if (pullRequest.state !== 'open')
		reasons.push({ code: 'pull_request_not_open', state: pullRequest.state })

	return reasons
}

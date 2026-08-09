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
import { RepositoriesService } from '@modules/repositories'
import { Injectable, Logger } from '@nestjs/common'
import type {
	ChecksList,
	MergeBlockingReason,
	MergePullRequestResult,
	MergeRequirements,
	ParsedCreatePullRequestInput,
	ParsedEditPullRequestInput,
	ParsedGetPullRequestFileDiffInput,
	ParsedGetPullRequestInput,
	ParsedGetPullRequestReviewComparisonInput,
	ParsedListPullRequestChecksInput,
	ParsedListPullRequestsInput,
	ParsedMergePullRequestInput,
	PullRequest,
	PullRequestAuthority,
	PullRequestComparison,
	PullRequestFileDiff,
	PullRequestListItem,
	PullRequestReviewComparison,
	PullRequestReviewComparisonContext,
	PullRequestReviewSummary,
	RepositoryViewerRole,
} from '@repo/contracts'
import type { GitHubActorId, PullRequest as PullRequestEntity } from '@repo/db'
import type {
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositoryRole,
	UserId,
} from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	assertPullRequestClosable,
	assertPullRequestEditable,
	assertPullRequestReopenable,
	toPullRequestEventOutput,
	toPullRequestOutput,
} from '../domain/pull-request'
import {
	PullRequestAlreadyOpenError,
	PullRequestInvalidBranchesError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { toPullRequestReviewComparisonContext } from '../domain/pull-request-review'
import { PullRequestReviewNotFoundError } from '../domain/pull-request-review.errors'
import { toMergeAuthorityReasons } from '../helpers/merge-authority-reasons'
import { toMergeBypassContext } from '../helpers/merge-bypass-context'
import { toPullRequestAuthority } from '../helpers/pull-request-authority'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import { highlightPullRequestDiff } from '../helpers/pull-request-diff-highlighting'
import { isMissingGitObjectError } from '../helpers/pull-request-storage-error'
import { MergeQueueRepository } from '../infrastructure/merge-queue.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { MergeQueueStatusService } from './merge-queue-status.service'
import { MergeRequirementsService } from './merge-requirements.service'
import { PullRequestHeadResolver } from './pull-request-head.resolver'
import {
	MERGE_INTENT_LEASE_MS,
	type PullRequestMergeActor,
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

export interface ListPullRequestsResult {
	pullRequests: PullRequestListItem[]
	authority: PullRequestAuthority
	viewerRole: RepositoryViewerRole
}

interface MergeUnderLeaseParams {
	actor: PullRequestMergeActor
	bypass?: ParsedMergePullRequestInput['bypass']
	expected: { baseSha: string; headSha: string }
	leaseOwner: string
	number: number
	repositoryId: RepositoryId
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
		private readonly gitStorageClient: GitStorageClient
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
		for (const pullRequest of pullRequests) {
			const authorActorId = actorIds.get(pullRequest.author.nodeId)
			const mergedByActorId = pullRequest.mergedBy
				? actorIds.get(pullRequest.mergedBy.nodeId)
				: undefined

			if (!authorActorId)
				throw new Error('synchronized pull request author mapping is missing')

			await this.pullRequestsRepository.reconcileGitHubPullRequest({
				repositoryId,
				pullRequest,
				authorActorId,
				mergedByActorId,
				pendingEvents: pendingEvents.filter(
					event => event.subjectNumber === pullRequest.number
				),
			})
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

			return toPullRequestOutput(pullRequest, username)
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
		{ slug, state, username }: ParsedListPullRequestsInput
	): Promise<ListPullRequestsResult> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequests = await this.pullRequestsRepository.list({
			repositoryId,
			state,
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

		return {
			pullRequests: pullRequests.map(pullRequest => ({
				...toPullRequestOutput(pullRequest, username),
				reviewSummary:
					reviewSummaries.get(pullRequest.id) ?? EMPTY_REVIEW_SUMMARY,
				checksSummary: checksSummaries.get(pullRequest.id),
			})),
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
				tesseraWritesAllowed,
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

		const comparison = await this.gitStorageClient.compareRepositoryRefs({
			repositoryId,
			storagePath,
			baseRef,
			headRef,
		})

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

	async edit(
		userId: UserId,
		{ body, number, slug, title, username }: ParsedEditPullRequestInput
	): Promise<PullRequest> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestEditable(pullRequest)

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

	async close(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequest> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestClosable(pullRequest)
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
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestReopenable(pullRequest)

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
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)

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
		{
			bypass,
			expectedBaseSha,
			expectedHeadSha,
			number,
			slug,
			username,
		}: ParsedMergePullRequestInput
	): Promise<MergePullRequestResult> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(actor.id, {
				username,
				slug,
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

		const requirements = await this.mergeRequirementsService.evaluate({
			expected,
			leaseOwner,
			pullRequest,
			repositoryId,
			storagePath,
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
			evaluatedBaseSha,
			evaluatedHeadSha,
			leaseOwner,
			pullRequest,
			repositoryId,
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
					tesseraWritesAllowed,
					toFallbackReasons: () => [toStateConflictReason(attempt.state)],
					viewerRole,
				})
		}
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
	kind: 'merge_conflict' | 'stale_refs'
	triedBaseSha: string
	triedHeadSha: string
}): MergeBlockingReason {
	if (kind === 'merge_conflict')
		return {
			code: 'merge_conflict',
			baseSha: triedBaseSha,
			headSha: triedHeadSha,
		}

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

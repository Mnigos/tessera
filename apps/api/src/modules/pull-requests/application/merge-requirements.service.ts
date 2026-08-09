import { GitStorageClient } from '@config/git-storage'
import {
	type BranchProtectionRuleView,
	BranchProtectionService,
} from '@modules/branch-protection'
import { ChecksEvaluationService } from '@modules/checks'
import { Injectable } from '@nestjs/common'
import {
	type MergeBlockingReason,
	type MergeRequirements,
	type PullRequestEffectiveReviewState,
} from '@repo/contracts'
import {
	hasRepositoryRole,
	type MergeBlockingReasonCode,
	type MergeQueueEntryId,
	type RepositoryId,
	type RepositoryRole,
} from '@repo/domain'
import { toPullRequestEffectiveReviewStates } from '../domain/pull-request-review'
import { toMergeAuthorityReasons } from '../helpers/merge-authority-reasons'
import { toMergeQueueBlockingReasons } from '../helpers/merge-queue-blocking-reasons'
import {
	type MergeQueueEntryReadModel,
	MergeQueueRepository,
} from '../infrastructure/merge-queue.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import { PullRequestThreadsRepository } from '../infrastructure/pull-request-threads.repository'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'

export interface EvaluateMergeRequirementsParams {
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
	tesseraWritesAllowed: boolean
	viewerRole?: RepositoryRole
	/**
	 * The refs the caller believes it is merging. Only a merge attempt has an
	 * expectation to disappoint; a read has none, so it never reports stale refs.
	 */
	expected?: {
		baseSha: string
		headSha: string
	}
	/**
	 * The lease this caller already holds, so a merge that has taken the
	 * repository does not then refuse itself for holding it.
	 */
	leaseOwner?: string
	/**
	 * The queue entry this evaluation runs on behalf of. Nothing about the queue
	 * refuses the entry the queue itself decided to run — its turn is what the
	 * ordering already settled — so its own presence is not reported back to it.
	 */
	queueEntryId?: MergeQueueEntryId
}

/**
 * The blockers policy is allowed to waive. Everything outside this set describes
 * a fact about the world — who the caller is, what state the pull request is in,
 * where the refs point, who else is merging — and no role can make it untrue.
 */
const BYPASSABLE_REASON_CODES = new Set<MergeBlockingReasonCode>([
	'approvals_required',
	'changes_requested',
	'checks_pending',
	'checks_failed',
	'threads_unresolved',
])

/**
 * Reasons are reported in one fixed order regardless of how they were found, so
 * a client can render a stable list and two evaluations of the same state
 * compare equal. It runs from the caller and the pull request, through the refs,
 * to the policy gates, and finally to whatever the queue is doing.
 */
const MERGE_BLOCKING_REASON_RANK: Record<MergeBlockingReasonCode, number> = {
	read_only_mirror: 0,
	insufficient_permission: 1,
	pull_request_not_open: 2,
	draft_pull_request: 3,
	stale_refs: 4,
	merge_conflict: 5,
	approvals_required: 6,
	changes_requested: 7,
	checks_failed: 8,
	checks_pending: 9,
	threads_unresolved: 10,
	merge_queue_required: 11,
	already_queued: 12,
	not_queue_head: 13,
	queue_paused: 14,
	repository_merge_in_progress: 15,
}

/**
 * Whether a pull request may be merged right now, and if not, why.
 *
 * Composes services rather than querying across contexts: the rule comes from
 * branch protection, the verdict on required checks from the checks module, the
 * refs and conflict answer from Git storage. Nothing here decides policy for
 * another context — it asks each one and assembles the answer.
 *
 * Every merge path evaluates through this, immediately before merging. A
 * requirements read is advisory the moment it is returned; only the evaluation
 * the merge itself performs governs anything.
 */
@Injectable()
export class MergeRequirementsService {
	constructor(
		private readonly branchProtectionService: BranchProtectionService,
		private readonly checksEvaluationService: ChecksEvaluationService,
		private readonly mergeQueueRepository: MergeQueueRepository,
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly pullRequestThreadsRepository: PullRequestThreadsRepository,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async evaluate({
		expected,
		leaseOwner,
		pullRequest,
		queueEntryId,
		repositoryId,
		storagePath,
		tesseraWritesAllowed,
		viewerRole,
	}: EvaluateMergeRequirementsParams): Promise<MergeRequirements> {
		const rule = await this.branchProtectionService.findRuleForBranch({
			repositoryId,
			targetBranch: pullRequest.targetBranch,
		})
		const reasons: MergeBlockingReason[] = toMergeAuthorityReasons({
			tesseraWritesAllowed,
			viewerRole,
		})

		if (pullRequest.github?.draft) reasons.push({ code: 'draft_pull_request' })

		// A closed pull request has no live comparison left to judge, and asking Git
		// for one would answer about branches that moved on without it.
		if (pullRequest.state !== 'open') {
			reasons.push({
				code: 'pull_request_not_open',
				state: pullRequest.state,
			})

			return this.toRequirements({ reasons, rule, viewerRole })
		}

		const refs = await this.resolveRefs({
			pullRequest,
			repositoryId,
			storagePath,
			tesseraWritesAllowed,
		})

		if (
			expected &&
			(expected.baseSha !== refs.baseSha || expected.headSha !== refs.headSha)
		)
			reasons.push({
				code: 'stale_refs',
				expectedBaseSha: expected.baseSha,
				actualBaseSha: refs.baseSha,
				expectedHeadSha: expected.headSha,
				actualHeadSha: refs.headSha,
			})

		if (refs.mergeable === false)
			reasons.push({
				code: 'merge_conflict',
				baseSha: refs.baseSha,
				headSha: refs.headSha,
			})

		const [policyReasons, queueReasons] = await Promise.all([
			this.evaluatePolicy({
				headSha: refs.headSha,
				pullRequest,
				repositoryId,
				rule,
			}),
			this.evaluateQueueState({
				leaseOwner,
				pullRequest,
				queueEntryId,
				repositoryId,
			}),
		])

		reasons.push(...policyReasons, ...queueReasons)

		return this.toRequirements({
			baseSha: refs.baseSha,
			headSha: refs.headSha,
			reasons,
			rule,
			viewerRole,
		})
	}

	/**
	 * Where the branches point and whether they still combine.
	 *
	 * The shortcut is keyed on authority rather than on where the pull request
	 * came from. A repository Tessera may not write to will never merge here, so
	 * spending a Git round trip to describe a merge that is refused anyway is
	 * wasted — and for a synchronized pull request the provider's own SHAs are the
	 * ones its reviews and checks are attached to. Once writes are allowed, a
	 * GitHub-mapped pull request is merged from Tessera's refs like any other and
	 * has to be judged against them, mergeability included.
	 */
	private async resolveRefs({
		pullRequest,
		repositoryId,
		storagePath,
		tesseraWritesAllowed,
	}: {
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		storagePath: string
		tesseraWritesAllowed: boolean
	}): Promise<{ baseSha: string; headSha: string; mergeable?: boolean }> {
		if (!tesseraWritesAllowed)
			return pullRequest.github
				? {
						baseSha: pullRequest.github.baseSha,
						headSha: pullRequest.github.headSha,
					}
				: {
						baseSha: pullRequest.openingBaseSha,
						headSha: pullRequest.openingHeadSha,
					}

		const mergeability =
			await this.gitStorageClient.checkRepositoryMergeability({
				repositoryId,
				storagePath,
				baseRef: pullRequest.targetBranch,
				headRef: pullRequest.sourceBranch,
			})

		return {
			baseSha: mergeability.baseSha,
			headSha: mergeability.headSha,
			mergeable: mergeability.mergeable,
		}
	}

	/**
	 * The gates the branch's rule configures. Without a rule the branch is not
	 * protected, so reviews, checks and threads are advisory and none of them
	 * refuses a merge.
	 */
	private async evaluatePolicy({
		headSha,
		pullRequest,
		repositoryId,
		rule,
	}: {
		headSha: string
		pullRequest: PullRequestReadModel
		repositoryId: RepositoryId
		rule?: BranchProtectionRuleView
	}): Promise<MergeBlockingReason[]> {
		if (!rule) return []

		const [effectiveReviews, checks, unresolvedThreads] = await Promise.all([
			this.listEffectiveReviewStates(pullRequest, headSha),
			rule.requiredCheckContexts.length > 0
				? this.checksEvaluationService.evaluate(
						repositoryId,
						headSha,
						rule.requiredCheckContexts
					)
				: undefined,
			rule.requireThreadsResolved
				? this.pullRequestThreadsRepository.countUnresolvedThreads({
						pullRequestId: pullRequest.id,
					})
				: 0,
		])
		const reasons: MergeBlockingReason[] = []
		const approvals = effectiveReviews.filter(
			review => review.outcome === 'approve'
		)
		// Dismissing stale approvals is a read-time exclusion: the review keeps its
		// row and stays visible as stale, it simply stops counting. With the flag
		// off the same approval still counts toward the requirement, and the count
		// reported here is of approvals this rule actually discounted — zero, in
		// that case — rather than of approvals that merely went stale.
		const discountedApprovals = rule.dismissStaleApprovals
			? approvals.filter(review => review.stale).length
			: 0
		const countedApprovals = approvals.length - discountedApprovals

		if (rule.requiredApprovals > 0 && countedApprovals < rule.requiredApprovals)
			reasons.push({
				code: 'approvals_required',
				required: rule.requiredApprovals,
				approved: countedApprovals,
				staleApprovals: discountedApprovals,
			})

		// Staleness never excuses a change request. Only the reviewer withdrawing it
		// or an administrator dismissing the review clears one.
		const changeRequests = effectiveReviews.filter(
			review => review.outcome === 'request_changes'
		)

		if (changeRequests.length > 0)
			reasons.push({ code: 'changes_requested', reviewers: changeRequests })

		if (checks && checks.failing.length > 0)
			reasons.push({ code: 'checks_failed', contexts: checks.failing })

		if (checks && checks.pending.length > 0)
			reasons.push({ code: 'checks_pending', contexts: checks.pending })

		if (unresolvedThreads > 0)
			reasons.push({ code: 'threads_unresolved', count: unresolvedThreads })

		return reasons
	}

	/**
	 * What the queue and the repository lease have to say. A repository with
	 * entries waiting merges through the queue, so an ordinary direct merge is
	 * refused rather than allowed to jump ahead of them.
	 */
	private async evaluateQueueState({
		leaseOwner,
		pullRequest,
		queueEntryId,
		repositoryId,
	}: {
		leaseOwner?: string
		pullRequest: PullRequestReadModel
		queueEntryId?: MergeQueueEntryId
		repositoryId: RepositoryId
	}): Promise<MergeBlockingReason[]> {
		const [entry, runnableCount, currentLeaseOwner] = await Promise.all([
			this.mergeQueueRepository.findActiveEntry({
				pullRequestId: pullRequest.id,
			}),
			this.mergeQueueRepository.countRunnableEntries({ repositoryId }),
			this.mergeQueueRepository.findRepositoryMergeLeaseOwner({
				repositoryId,
			}),
		])
		const reasons: MergeBlockingReason[] = []

		// The worker evaluating the entry it is running is the queue speaking about
		// itself, and it has nothing to tell itself: being queued is why this
		// evaluation is happening, and its turn was settled by picking it.
		const isOwnEntry = entry !== undefined && entry.id === queueEntryId

		if (!isOwnEntry) {
			if (entry?.state === 'paused')
				reasons.push({
					code: 'queue_paused',
					reasons: toMergeQueueBlockingReasons(entry.blockingReasons) ?? [],
				})
			else if (entry) {
				reasons.push({ code: 'already_queued', state: entry.state })
				reasons.push(...(await this.toQueuePlaceReasons(entry, repositoryId)))
			} else if (runnableCount > 0)
				reasons.push({ code: 'merge_queue_required' })
		}

		// A merge evaluates under a lease it took itself, and the only acceptable
		// answer for it is that the repository still says so. An unowned row means
		// its hold aged out while the evaluation ran, which is exactly as
		// disqualifying as somebody else holding it — a read, which took no lease,
		// only cares whether anyone else is merging.
		if (
			leaseOwner ? currentLeaseOwner !== leaseOwner : Boolean(currentLeaseOwner)
		)
			reasons.push({ code: 'repository_merge_in_progress' })

		return reasons
	}

	/**
	 * Where a queued entry stands, when it is not the one the queue will run next.
	 *
	 * Being queued and being behind others are two different things to be told,
	 * and only the second one says how long the wait is. The place is counted the
	 * same way the queue panel counts it — among the entries that can still run —
	 * so the number in the refusal is the number the reader sees beside it. The
	 * entry at the front has no such reason: nothing is ahead of it.
	 */
	private async toQueuePlaceReasons(
		entry: MergeQueueEntryReadModel,
		repositoryId: RepositoryId
	): Promise<MergeBlockingReason[]> {
		const aheadCount = await this.mergeQueueRepository.countRunnableEntries({
			repositoryId,
			beforePosition: entry.position,
		})

		if (aheadCount === 0) return []

		return [{ code: 'not_queue_head', position: aheadCount + 1 }]
	}

	/**
	 * Effective review states against the head being merged, taken raw rather than
	 * through the review summary: the summary drops stale approvals for everybody,
	 * while the rule is what decides whether a stale approval still counts here.
	 */
	private async listEffectiveReviewStates(
		pullRequest: PullRequestReadModel,
		headSha: string
	): Promise<PullRequestEffectiveReviewState[]> {
		const reviews = await this.pullRequestReviewsRepository.listReviewHistory({
			pullRequestId: pullRequest.id,
		})

		return toPullRequestEffectiveReviewStates(reviews, {
			authorUserId: pullRequest.authorUserId,
			authorActorNodeId: pullRequest.authorActorNodeId,
			currentHeadSha: headSha,
		})
	}

	private toRequirements({
		baseSha,
		headSha,
		reasons,
		rule,
		viewerRole,
	}: {
		baseSha?: string
		headSha?: string
		reasons: MergeBlockingReason[]
		rule?: BranchProtectionRuleView
		viewerRole?: RepositoryRole
	}): MergeRequirements {
		const orderedReasons = [...reasons].sort(
			(left, right) =>
				MERGE_BLOCKING_REASON_RANK[left.code] -
				MERGE_BLOCKING_REASON_RANK[right.code]
		)

		return {
			eligible: orderedReasons.length === 0,
			evaluatedBaseSha: baseSha,
			evaluatedHeadSha: headSha,
			rule: rule
				? {
						id: rule.id,
						version: rule.version,
						targetBranch: rule.targetBranch,
					}
				: undefined,
			canBypass: canBypass(orderedReasons, rule, viewerRole),
			reasons: orderedReasons,
		}
	}
}

/**
 * A bypass is offered only when there is something to bypass, the rule hands
 * bypass to a role, the viewer holds it, and every current blocker is one policy
 * may waive. One never-bypassable reason withdraws the affordance entirely.
 */
function canBypass(
	reasons: MergeBlockingReason[],
	rule: BranchProtectionRuleView | undefined,
	viewerRole: RepositoryRole | undefined
): boolean {
	if (reasons.length === 0) return false
	if (!rule?.bypassMinimumRole) return false
	if (!hasRepositoryRole(viewerRole, rule.bypassMinimumRole)) return false

	return reasons.every(reason => BYPASSABLE_REASON_CODES.has(reason.code))
}

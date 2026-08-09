import type { MergeBlockingReason, MergeQueueState } from '@repo/contracts'

/** One sentence per refusal, said in the terms the reader can act on. */
export function getMergeBlockingReasonMessage(
	reason: MergeBlockingReason
): string {
	switch (reason.code) {
		case 'insufficient_permission':
			return 'You need write access to this repository to merge.'
		case 'pull_request_not_open':
			return `This pull request is ${reason.state}.`
		case 'draft_pull_request':
			return 'This pull request is still a draft.'
		case 'read_only_mirror':
			return 'GitHub owns this repository, so merges happen there.'
		case 'stale_refs':
			return 'The source or target branch changed. Refresh and try again.'
		case 'merge_conflict':
			return 'The source branch conflicts with the target branch.'
		case 'approvals_required':
			return toApprovalsMessage(reason)
		case 'changes_requested':
			return `${toReviewerList(reason.reviewers)} requested changes.`
		case 'checks_pending':
			return `Required checks are still running: ${toContextList(reason.contexts)}.`
		case 'checks_failed':
			return `Required checks did not pass: ${toContextList(reason.contexts)}.`
		case 'threads_unresolved':
			return `${reason.count} comment ${reason.count === 1 ? 'thread is' : 'threads are'} unresolved.`
		case 'merge_queue_required':
			return 'This repository merges through its merge queue.'
		case 'already_queued':
			return `This pull request is already in the merge queue (${reason.state}).`
		case 'not_queue_head':
			return `This pull request is number ${reason.position} in the merge queue.`
		case 'queue_paused':
			return 'The merge queue paused this pull request.'
		case 'repository_merge_in_progress':
			return 'Another merge is running in this repository.'
		default:
			// Every code the contract can send has a sentence above, so nothing
			// reaches this branch and `reason` is narrowed to never. A code added to
			// the contract without one here fails typecheck rather than reaching the
			// reader as something vague.
			reason satisfies never

			return 'This merge is blocked.'
	}
}

/**
 * What to do about the refusal, where doing something is possible.
 *
 * Separate from the message because the two answer different questions, and
 * several blockers have no answer at all: waiting for a check to finish or for
 * the queue to reach you is not an action.
 */
export function getMergeBlockingReasonHint(
	reason: MergeBlockingReason
): string | undefined {
	switch (reason.code) {
		case 'stale_refs':
			return `The branches now point at ${toShortSha(reason.actualBaseSha)} and ${toShortSha(reason.actualHeadSha)}.`
		case 'merge_conflict':
			return 'Merge the target branch into the source branch and resolve the conflicts.'
		case 'changes_requested':
			return 'The review has to be approved or dismissed before this can merge.'
		case 'checks_failed':
			return 'Push a fix, or re-run the failing checks.'
		case 'threads_unresolved':
			return 'Resolve the remaining conversations, or ask their authors to.'
		case 'merge_queue_required':
			return 'Join the queue below to merge in turn.'
		case 'queue_paused':
			return 'Resolve what stopped it, then retry the entry.'
		default:
			return undefined
	}
}

/** What a queue entry is currently doing, as a short label. */
export function getMergeQueueStateLabel(state: MergeQueueState): string {
	switch (state) {
		case 'queued':
			return 'Waiting'
		case 'validating':
			return 'Checking requirements'
		case 'merging':
			return 'Merging'
		case 'paused':
			return 'Paused'
		case 'completed':
			return 'Merged'
		default:
			return 'Left the queue'
	}
}

function toShortSha(sha: string): string {
	return sha.slice(0, 7)
}

function toApprovalsMessage({
	approved,
	required,
	staleApprovals,
}: Extract<MergeBlockingReason, { code: 'approvals_required' }>): string {
	const counts = `${approved} of ${required} required approvals.`

	if (staleApprovals === 0) return counts

	// The reviews are still there and still visible; the rule stopped counting
	// them when the head moved past what they approved.
	return `${counts} ${staleApprovals} ${staleApprovals === 1 ? 'approval no longer counts' : 'approvals no longer count'} because the branch moved.`
}

function toReviewerList(
	reviewers: Extract<
		MergeBlockingReason,
		{ code: 'changes_requested' }
	>['reviewers']
): string {
	const usernames = reviewers.map(({ reviewer }) => reviewer.username)

	return usernames.length > 0 ? usernames.join(', ') : 'A reviewer'
}

function toContextList(
	contexts: Extract<
		MergeBlockingReason,
		{ code: 'checks_pending' | 'checks_failed' }
	>['contexts']
): string {
	return contexts.map(({ requirement }) => requirement.context).join(', ')
}

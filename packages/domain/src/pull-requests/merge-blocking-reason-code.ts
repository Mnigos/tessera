/**
 * The vocabulary a merge evaluation refuses with. Audit rows store codes alone
 * while the API returns the full reason with its details, so both sides have to
 * agree on the names — that agreement lives here.
 */
export const mergeBlockingReasonCodes = [
	'insufficient_permission',
	'pull_request_not_open',
	'draft_pull_request',
	'read_only_mirror',
	'stale_refs',
	'merge_conflict',
	'approvals_required',
	'changes_requested',
	'checks_pending',
	'checks_failed',
	'threads_unresolved',
	'merge_queue_required',
	'already_queued',
	'not_queue_head',
	'queue_paused',
	'repository_merge_in_progress',
] as const

export type MergeBlockingReasonCode = (typeof mergeBlockingReasonCodes)[number]

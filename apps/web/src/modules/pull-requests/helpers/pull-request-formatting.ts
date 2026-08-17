import type {
	PullRequestActor,
	PullRequestEvent,
	PullRequestEventType,
	PullRequestState,
} from '@repo/contracts'
import { getPullRequestReviewerEventPayload } from './pull-request-review'

const REVIEWER_TARGETED_EVENT_DESCRIPTIONS: Partial<
	Record<PullRequestEventType, (reviewerUsername: string) => string>
> = {
	review_requested: reviewerUsername =>
		`Review requested from ${reviewerUsername}`,
	review_request_removed: reviewerUsername =>
		`Review request for ${reviewerUsername} removed`,
}

/**
 * How a branch movement is worded once the event says where the branch went.
 * Only native push events carry that payload, so the labels below stay the
 * fallback for provider-synchronized history.
 */
const PULL_REQUEST_HEAD_UPDATE_VERBS: Partial<
	Record<PullRequestEventType, string>
> = {
	head_updated: 'Updated',
	force_pushed: 'Force-pushed',
}

const HEADS_REF_PREFIX = 'refs/heads/'

const PULL_REQUEST_STATE_LABELS: Record<PullRequestState, string> = {
	open: 'Open',
	closed: 'Closed',
	merged: 'Merged',
}

const PULL_REQUEST_EVENT_LABELS: Record<PullRequestEventType, string> = {
	opened: 'Pull request opened',
	edited: 'Pull request edited',
	closed: 'Pull request closed',
	reopened: 'Pull request reopened',
	merged: 'Pull request merged',
	synchronized: 'Pull request synchronized',
	retargeted: 'Pull request retargeted',
	converted_to_draft: 'Pull request converted to draft',
	ready_for_review: 'Pull request marked ready for review',
	assigned: 'Pull request assigned',
	review_requested: 'Pull request review requested',
	labeled: 'Pull request labeled',
	commented: 'Pull request commented',
	thread_resolved: 'Comment thread resolved',
	thread_unresolved: 'Comment thread unresolved',
	review_request_removed: 'Pull request review request removed',
	review_submitted: 'Pull request review submitted',
	review_dismissed: 'Pull request review dismissed',
	merge_blocked: 'Merge blocked by branch protection',
	merge_bypassed: 'Merge requirements bypassed',
	queue_entered: 'Added to the merge queue',
	queue_paused: 'Merge queue entry paused',
	queue_resumed: 'Merge queue entry resumed',
	queue_removed: 'Removed from the merge queue',
	head_updated: 'Source branch updated',
	force_pushed: 'Source branch force-pushed',
}

const PULL_REQUEST_MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
] as const

/**
 * Returns the display label for a pull request state.
 */
export function getPullRequestStateLabel(state: PullRequestState) {
	return PULL_REQUEST_STATE_LABELS[state]
}

/**
 * Returns the display label for a pull request event.
 */
export function getPullRequestEventLabel(type: PullRequestEventType) {
	return PULL_REQUEST_EVENT_LABELS[type]
}

/**
 * Describes an event for the timeline, naming the targeted reviewer when the
 * event carries one. Provider-synchronized history has no payload, so the
 * generic label stays the fallback.
 */
export function getPullRequestEventDescription(event: PullRequestEvent) {
	const describeReviewer = REVIEWER_TARGETED_EVENT_DESCRIPTIONS[event.type]
	const reviewer = getPullRequestReviewerEventPayload(event)

	if (describeReviewer && reviewer)
		return describeReviewer(reviewer.reviewerUsername)

	return getPullRequestEventLabel(event.type)
}

/**
 * Reads where a push moved the pull request's source branch, so the timeline
 * can name the branch and both commits instead of only saying it moved. Absent
 * for every event that is not a native push.
 */
export function getPullRequestHeadUpdate(event: PullRequestEvent) {
	const verb = PULL_REQUEST_HEAD_UPDATE_VERBS[event.type]
	const { payload } = event

	if (!(verb && payload && 'ref' in payload)) return undefined

	return {
		verb,
		branch: payload.ref.startsWith(HEADS_REF_PREFIX)
			? payload.ref.slice(HEADS_REF_PREFIX.length)
			: payload.ref,
		oldSha: payload.oldSha,
		newSha: payload.newSha,
	}
}

/**
 * Reads where a retarget moved the pull request's target branch, so the
 * timeline can name both branches instead of only saying the target changed.
 * Provider-synchronized retargets carry no payload and keep the generic label.
 */
export function getPullRequestRetarget(event: PullRequestEvent) {
	const { payload } = event

	if (!(event.type === 'retargeted' && payload && 'toBranch' in payload))
		return undefined

	return { fromBranch: payload.fromBranch, toBranch: payload.toBranch }
}

/**
 * Formats a pull request timestamp deterministically in UTC for SSR hydration.
 */
export function formatPullRequestDate(date: Date) {
	const hours = date.getUTCHours()
	const displayHours = hours % 12 || 12
	const minutes = String(date.getUTCMinutes()).padStart(2, '0')
	const period = hours >= 12 ? 'PM' : 'AM'

	return `${PULL_REQUEST_MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${displayHours}:${minutes} ${period} UTC`
}

/**
 * Abbreviates a commit for display. The full value belongs in a title or
 * tooltip beside it: seven characters name a commit, they do not identify it.
 */
export function formatPullRequestShortSha(sha: string) {
	return sha.slice(0, 7)
}

/**
 * Converts a pull request timestamp to the ISO value used by time elements.
 */
export function formatPullRequestDateTime(date: Date) {
	return date.toISOString()
}

/**
 * How an actor is named on screen: the profile name Tessera holds, falling back
 * to the login for a GitHub account the projection knows no name for.
 */
export function getPullRequestActorName(actor: PullRequestActor) {
	return actor.displayName ?? actor.username
}

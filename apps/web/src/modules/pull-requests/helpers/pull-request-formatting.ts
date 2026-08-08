import type {
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
 * Converts a pull request timestamp to the ISO value used by time elements.
 */
export function formatPullRequestDateTime(date: Date) {
	return date.toISOString()
}

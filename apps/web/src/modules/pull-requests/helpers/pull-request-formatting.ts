import type { PullRequestEventType, PullRequestState } from '@repo/contracts'

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

/**
 * Formats a user id for compact pull request activity metadata.
 */
export function formatPullRequestActor(userId: string) {
	return userId.slice(0, 8)
}

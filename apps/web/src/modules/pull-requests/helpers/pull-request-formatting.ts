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

export function getPullRequestStateLabel(state: PullRequestState) {
	return PULL_REQUEST_STATE_LABELS[state]
}

export function getPullRequestEventLabel(type: PullRequestEventType) {
	return PULL_REQUEST_EVENT_LABELS[type]
}

export function formatPullRequestDate(date: Date) {
	return new Intl.DateTimeFormat('en', {
		dateStyle: 'medium',
		timeStyle: 'short',
		timeZone: 'UTC',
	}).format(date)
}

export function formatPullRequestDateTime(date: Date) {
	return date.toISOString()
}

export function formatPullRequestActor(userId: string) {
	return userId.slice(0, 8)
}

import type { PullRequestEventType, PullRequestState } from '@repo/contracts'

const pullRequestStateLabels: Record<PullRequestState, string> = {
	open: 'Open',
	closed: 'Closed',
	merged: 'Merged',
}

const pullRequestEventLabels: Record<PullRequestEventType, string> = {
	opened: 'Pull request opened',
	edited: 'Pull request edited',
	closed: 'Pull request closed',
	reopened: 'Pull request reopened',
	merged: 'Pull request merged',
}

export function getPullRequestStateLabel(state: PullRequestState) {
	return pullRequestStateLabels[state]
}

export function getPullRequestEventLabel(type: PullRequestEventType) {
	return pullRequestEventLabels[type]
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

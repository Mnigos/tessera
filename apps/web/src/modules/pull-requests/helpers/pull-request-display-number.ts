import type { PullRequest } from '@repo/contracts'

// Shown text only; routes and mutations keep addressing the local number.
export function toPullRequestDisplayNumber(
	pullRequest: Pick<PullRequest, 'github' | 'number'>
) {
	return pullRequest.github?.externalNumber ?? pullRequest.number
}

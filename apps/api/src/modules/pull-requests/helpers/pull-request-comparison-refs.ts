import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'

export interface PullRequestComparisonRefs {
	baseRef: string
	headRef: string
}

export function getPullRequestComparisonRefs(
	pullRequest: PullRequestReadModel
): PullRequestComparisonRefs {
	if (pullRequest.github)
		return {
			baseRef: pullRequest.github.baseSha,
			headRef: pullRequest.github.headSha,
		}

	if (pullRequest.state === 'merged' && pullRequest.mergeCommitSha)
		return {
			baseRef: `${pullRequest.mergeCommitSha}^1`,
			headRef: `${pullRequest.mergeCommitSha}^2`,
		}

	return {
		baseRef: pullRequest.targetBranch,
		headRef: pullRequest.sourceBranch,
	}
}

import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'

export interface PullRequestComparisonRefs {
	baseRef: string
	headRef: string
}

/**
 * The pair a pull request's diff is read from.
 *
 * While it is open the branches themselves answer. Once it is merged they no
 * longer do — the source may be deleted and the target has moved on — so the
 * merge records the tips it actually combined and those are used verbatim. Only
 * rows merged before that was recorded fall back to the merge commit's parents,
 * and only a two-parent merge commit has a second parent to fall back to: a
 * squash, a rebase or a fast-forward never leaves one, which is why the pair is
 * persisted rather than derived.
 *
 * The Git service keeps both commits reachable through the merge's operation
 * receipt, so this pair stays resolvable after the source branch is deleted.
 */
export function getPullRequestComparisonRefs(
	pullRequest: PullRequestReadModel
): PullRequestComparisonRefs {
	if (pullRequest.github)
		return {
			baseRef: pullRequest.github.baseSha,
			headRef: pullRequest.github.headSha,
		}

	if (pullRequest.state === 'merged') {
		if (pullRequest.mergedBaseSha && pullRequest.mergedHeadSha)
			return {
				baseRef: pullRequest.mergedBaseSha,
				headRef: pullRequest.mergedHeadSha,
			}

		if (pullRequest.mergeCommitSha)
			return {
				baseRef: `${pullRequest.mergeCommitSha}^1`,
				headRef: `${pullRequest.mergeCommitSha}^2`,
			}
	}

	return {
		baseRef: pullRequest.targetBranch,
		headRef: pullRequest.sourceBranch,
	}
}

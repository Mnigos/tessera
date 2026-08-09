import type { MergeStrategySelection } from '@repo/contracts'
import type { MergeStrategy } from '@repo/domain'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'

/**
 * Exactly what git storage will be asked to do, resolved once and then carried
 * unchanged: it is written to the merge intent before Git is called and replayed
 * from there if the process dies mid-merge. Git recognises its own completed
 * work by the tips and strategy it recorded, so a replay that differs in any
 * field is a different merge as far as it is concerned.
 */
export interface PullRequestMergeRequest {
	/** Present for `merge_commit` alone. */
	commitMessage?: string
	expectedBaseSha: string
	expectedHeadSha: string
	/** Present for `squash` alone. */
	squashBody?: string
	squashTitle?: string
	strategy: MergeStrategy
}

/**
 * Fills in what the caller left out.
 *
 * Both defaults are derived from the pull request as it is stored rather than
 * from anything the client sent, so a caller who supplies nothing still gets a
 * message that describes the merge truthfully. An override is validated by the
 * contract on the way in and sanitised again by git storage on the way out.
 */
export function toPullRequestMergeRequest({
	evaluatedBaseSha,
	evaluatedHeadSha,
	pullRequest,
	selection,
}: {
	evaluatedBaseSha: string
	evaluatedHeadSha: string
	pullRequest: PullRequestReadModel
	selection: MergeStrategySelection
}): PullRequestMergeRequest {
	const request = {
		expectedBaseSha: evaluatedBaseSha,
		expectedHeadSha: evaluatedHeadSha,
		strategy: selection.strategy,
	}

	if (selection.strategy === 'merge_commit')
		return {
			...request,
			commitMessage: `Merge pull request #${pullRequest.number}: ${toCommitSubject(pullRequest.title)}`,
		}

	if (selection.strategy === 'squash')
		return {
			...request,
			squashTitle:
				selection.squashTitle ??
				`${toCommitSubject(pullRequest.title)} (#${pullRequest.number})`,
			squashBody: toCommitBody(selection.squashBody ?? pullRequest.body),
		}

	return request
}

/**
 * A stored title reduced to something that can be a commit subject.
 *
 * New titles are held to one line and no NUL by the contract, but rows written
 * before that was true are still out there, and git storage refuses both. It
 * would refuse them as invalid input, which reaches the reader as a merge that
 * mysteriously will not go through rather than as the old data it is.
 */
function toCommitSubject(title: string): string {
	return toCommitBody(title).split('\n')[0]?.trim() || 'Untitled'
}

/** The same, for text that is allowed to span lines. */
function toCommitBody(body: string): string {
	return body.replaceAll('\0', '')
}

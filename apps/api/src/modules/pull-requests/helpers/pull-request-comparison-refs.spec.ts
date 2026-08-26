import type { PullRequestId, RepositoryId, UserId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'
import { getPullRequestComparisonRefs } from './pull-request-comparison-refs'

const createdAt = new Date('2026-07-11T00:00:00Z')
const baseSha = 'a'.repeat(40)
const headSha = 'b'.repeat(40)
const resultingSha = 'c'.repeat(40)

function pullRequest(
	overrides: Partial<PullRequestReadModel> = {}
): PullRequestReadModel {
	return {
		id: '00000000-0000-4000-8000-000000000044' as PullRequestId,
		repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
		provider: 'tessera',
		number: 1,
		authorUserId: mockUserId as UserId,
		sourceBranch: 'feature',
		targetBranch: 'main',
		openingBaseSha: 'opening-base',
		openingHeadSha: 'opening-head',
		title: 'Add feature',
		body: '',
		state: 'open',
		mergeCommitSha: null,
		mergeStrategy: null,
		mergedBaseSha: null,
		mergedHeadSha: null,
		mergeActorUserId: null,
		diffStatsBaseSha: null,
		diffStatsHeadSha: null,
		diffAdditions: null,
		diffDeletions: null,
		diffChangedFiles: null,
		diffCommitCount: null,
		diffStatsUpdatedAt: null,
		createdAt,
		updatedAt: createdAt,
		closedAt: null,
		mergedAt: null,
		...overrides,
	}
}

describe(getPullRequestComparisonRefs.name, () => {
	test('reads an open pull request from its branches', () => {
		expect(getPullRequestComparisonRefs(pullRequest())).toEqual({
			baseRef: 'main',
			headRef: 'feature',
		})
	})

	test('reads a synchronized pull request from the provider SHAs', () => {
		expect(
			getPullRequestComparisonRefs(
				pullRequest({
					github: {
						nodeId: 'node',
						htmlUrl: 'https://github.com/marta/notes/pull/1',
						draft: false,
						baseSha: 'github-base',
						headSha: 'github-head',
					},
				})
			)
		).toEqual({ baseRef: 'github-base', headRef: 'github-head' })
	})

	// Every strategy records what it merged, so no strategy has to be inferred
	// from the shape of the commit it left behind.
	test.each([
		'merge_commit',
		'squash',
		'rebase',
		'fast_forward',
	] as const)('reads a %s merge from the tips it recorded', strategy => {
		expect(
			getPullRequestComparisonRefs(
				pullRequest({
					state: 'merged',
					mergeStrategy: strategy,
					mergeCommitSha: resultingSha,
					mergedBaseSha: baseSha,
					mergedHeadSha: headSha,
				})
			)
		).toEqual({ baseRef: baseSha, headRef: headSha })
	})

	// Rows merged before the tips were recorded have only the merge commit, and
	// it is always a two-parent one: nothing else could have made them.
	test('falls back to the merge commit parents for a legacy merge', () => {
		expect(
			getPullRequestComparisonRefs(
				pullRequest({
					state: 'merged',
					mergeStrategy: 'merge_commit',
					mergeCommitSha: resultingSha,
				})
			)
		).toEqual({ baseRef: `${resultingSha}^1`, headRef: `${resultingSha}^2` })
	})

	// A merged row with neither the tips nor a resulting commit is not a state
	// the lifecycle constraint permits, and guessing at a pair would produce a
	// comparison of two things that were never compared.
	test('falls back to the branches when a merged row records nothing', () => {
		expect(
			getPullRequestComparisonRefs(pullRequest({ state: 'merged' }))
		).toEqual({ baseRef: 'main', headRef: 'feature' })
	})

	test('ignores merge-time tips while the pull request is still open', () => {
		expect(
			getPullRequestComparisonRefs(
				pullRequest({ mergedBaseSha: baseSha, mergedHeadSha: headSha })
			)
		).toEqual({ baseRef: 'main', headRef: 'feature' })
	})
})

import type { PullRequestId, RepositoryId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'
import { toPullRequestMergeRequest } from './pull-request-merge-request'

const createdAt = new Date('2026-07-11T00:00:00Z')
const evaluatedBaseSha = 'a'.repeat(40)
const evaluatedHeadSha = 'b'.repeat(40)
const pullRequest: PullRequestReadModel = {
	id: '00000000-0000-4000-8000-000000000044' as PullRequestId,
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	provider: 'tessera',
	number: 7,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'opening-base',
	openingHeadSha: 'opening-head',
	title: 'Add search',
	body: 'Why it changed',
	state: 'open',
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}

function build(
	selection: Parameters<typeof toPullRequestMergeRequest>[0]['selection']
) {
	return toPullRequestMergeRequest({
		evaluatedBaseSha,
		evaluatedHeadSha,
		pullRequest,
		selection,
	})
}

describe(toPullRequestMergeRequest.name, () => {
	test('sends the refs the evaluation resolved, whatever the strategy', () => {
		for (const strategy of [
			'merge_commit',
			'squash',
			'rebase',
			'fast_forward',
		] as const)
			expect(build({ strategy })).toMatchObject({
				strategy,
				expectedBaseSha: evaluatedBaseSha,
				expectedHeadSha: evaluatedHeadSha,
			})
	})

	test('writes a merge commit message naming the pull request', () => {
		expect(build({ strategy: 'merge_commit' })).toEqual({
			strategy: 'merge_commit',
			expectedBaseSha: evaluatedBaseSha,
			expectedHeadSha: evaluatedHeadSha,
			commitMessage: 'Merge pull request #7: Add search',
		})
	})

	// Derived from the stored pull request rather than from anything the client
	// sent, so a caller who supplies nothing still gets a truthful message.
	test('derives the squash message from the pull request', () => {
		expect(build({ strategy: 'squash' })).toEqual({
			strategy: 'squash',
			expectedBaseSha: evaluatedBaseSha,
			expectedHeadSha: evaluatedHeadSha,
			squashTitle: 'Add search (#7)',
			squashBody: 'Why it changed',
		})
	})

	test('prefers the squash message the caller wrote', () => {
		expect(
			build({
				strategy: 'squash',
				squashTitle: 'Rewritten title',
				squashBody: 'Rewritten body',
			})
		).toMatchObject({
			squashTitle: 'Rewritten title',
			squashBody: 'Rewritten body',
		})
	})

	// An empty body is a choice, not an omission: the pull request's body must
	// not creep back in over it.
	test('keeps an empty squash body the caller asked for', () => {
		expect(build({ strategy: 'squash', squashBody: '' })).toMatchObject({
			squashBody: '',
		})
	})

	// Titles written before the contract held them to one line are still stored,
	// and git storage refuses a multiline subject or a NUL as invalid input —
	// which would reach the reader as a merge that will not go through.
	test('reduces a legacy multiline title to a commit subject', () => {
		expect(
			toPullRequestMergeRequest({
				evaluatedBaseSha,
				evaluatedHeadSha,
				pullRequest: { ...pullRequest, title: 'Add search\nand more' },
				selection: { strategy: 'squash' },
			})
		).toMatchObject({ squashTitle: 'Add search (#7)' })
	})

	test('strips NUL from a legacy title and body', () => {
		expect(
			toPullRequestMergeRequest({
				evaluatedBaseSha,
				evaluatedHeadSha,
				pullRequest: {
					...pullRequest,
					title: 'Add\0search',
					body: 'Why\0it changed',
				},
				selection: { strategy: 'squash' },
			})
		).toMatchObject({
			squashTitle: 'Addsearch (#7)',
			squashBody: 'Whyit changed',
		})
	})

	test('names an empty legacy title rather than sending none', () => {
		expect(
			toPullRequestMergeRequest({
				evaluatedBaseSha,
				evaluatedHeadSha,
				pullRequest: { ...pullRequest, title: '\n' },
				selection: { strategy: 'squash' },
			})
		).toMatchObject({ squashTitle: 'Untitled (#7)' })
	})

	test.each([
		'rebase',
		'fast_forward',
	] as const)('writes no message for %s, which authors none', strategy => {
		expect(build({ strategy })).toEqual({
			strategy,
			expectedBaseSha: evaluatedBaseSha,
			expectedHeadSha: evaluatedHeadSha,
		})
	})
})

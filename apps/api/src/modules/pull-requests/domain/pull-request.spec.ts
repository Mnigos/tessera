import type { PullRequest } from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	assertPullRequestClosable,
	assertPullRequestEditable,
	assertPullRequestReopenable,
	toPullRequestOutput,
} from './pull-request'
import { PullRequestStateConflictError } from './pull-request.errors'

const createdAt = new Date('2026-07-11T00:00:00Z')
const pullRequest: PullRequest = {
	id: '00000000-0000-4000-8000-000000000044' as PullRequestId,
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'head-sha',
	title: 'Add feature',
	body: '',
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

describe('pull request domain', () => {
	test('maps nullable persistence fields to optional output fields', () => {
		expect(toPullRequestOutput(pullRequest, 'marta')).toEqual({
			...pullRequest,
			authorUsername: 'marta',
			github: undefined,
			mergeCommitSha: undefined,
			mergeStrategy: undefined,
			mergeActorUserId: undefined,
			closedAt: undefined,
			mergedAt: undefined,
		})
	})

	test('prefers a provider actor over the repository owner fallback', () => {
		expect(
			toPullRequestOutput(
				{ ...pullRequest, authorUsername: 'octocat' },
				'marta'
			).authorUsername
		).toBe('octocat')
	})

	test('allows editing open and closed pull requests', () => {
		expect(() => assertPullRequestEditable(pullRequest)).not.toThrow()
		expect(() =>
			assertPullRequestEditable({ ...pullRequest, state: 'closed' })
		).not.toThrow()
	})

	test('rejects editing merged pull requests', () => {
		expect(() =>
			assertPullRequestEditable({ ...pullRequest, state: 'merged' })
		).toThrow(PullRequestStateConflictError)
	})

	test('only allows closing open pull requests', () => {
		expect(() => assertPullRequestClosable(pullRequest)).not.toThrow()
		expect(() =>
			assertPullRequestClosable({ ...pullRequest, state: 'closed' })
		).toThrow(PullRequestStateConflictError)
	})

	test('only allows reopening closed pull requests', () => {
		expect(() =>
			assertPullRequestReopenable({ ...pullRequest, state: 'closed' })
		).not.toThrow()
		expect(() => assertPullRequestReopenable(pullRequest)).toThrow(
			PullRequestStateConflictError
		)
	})
})

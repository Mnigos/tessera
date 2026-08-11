import type { PullRequest } from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	assertPullRequestClosable,
	assertPullRequestEditable,
	assertPullRequestReopenable,
	assertPullRequestRetargetable,
	toPullRequestEventOutput,
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

	test('carries the joined GitHub identity onto a synchronized event', () => {
		expect(
			toPullRequestEventOutput({
				id: '00000000-0000-4000-8000-000000000055' as PullRequestEventId,
				pullRequestId: pullRequest.id,
				provider: 'github',
				actorUserId: null,
				type: 'closed',
				payload: null,
				createdAt,
				actorUsername: 'octocat',
				actor: {
					userId: null,
					username: null,
					externalNodeId: 'MDQ6VXNlcjE=',
					externalLogin: 'octocat',
					externalAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
					externalHtmlUrl: 'https://github.com/octocat',
				},
			}).actor
		).toEqual({
			key: 'MDQ6VXNlcjE=',
			provider: 'github',
			username: 'octocat',
			externalNodeId: 'MDQ6VXNlcjE=',
			avatarUrl: 'https://avatars.githubusercontent.com/u/1',
			htmlUrl: 'https://github.com/octocat',
		})
	})

	test('prefers the native account when one backs the event', () => {
		expect(
			toPullRequestEventOutput({
				id: '00000000-0000-4000-8000-000000000056' as PullRequestEventId,
				pullRequestId: pullRequest.id,
				provider: 'tessera',
				actorUserId: mockUserId,
				type: 'opened',
				payload: null,
				createdAt,
				actorUsername: 'marta',
				actor: {
					userId: mockUserId,
					username: 'marta',
					externalNodeId: null,
					externalLogin: null,
					externalAvatarUrl: null,
					externalHtmlUrl: null,
				},
			}).actor
		).toEqual({
			key: mockUserId,
			provider: 'tessera',
			userId: mockUserId,
			username: 'marta',
		})
	})

	test('leaves the actor absent when nothing identifies anybody', () => {
		expect(
			toPullRequestEventOutput({
				id: '00000000-0000-4000-8000-000000000057' as PullRequestEventId,
				pullRequestId: pullRequest.id,
				provider: 'tessera',
				actorUserId: null,
				type: 'queue_paused',
				payload: null,
				createdAt,
			}).actor
		).toBeUndefined()
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

// Retargeting is open-only, unlike editing: a closed pull request's target is a
// record of where it was going, and a merged one's is where it went.
describe('retargetable pull requests', () => {
	test('allows an open pull request', () => {
		expect(() => assertPullRequestRetargetable(pullRequest)).not.toThrow()
	})

	test.each([
		'closed',
		'merged',
	] as const)('refuses a %s pull request', state => {
		expect(() =>
			assertPullRequestRetargetable({ ...pullRequest, state })
		).toThrow(PullRequestStateConflictError)
	})
})

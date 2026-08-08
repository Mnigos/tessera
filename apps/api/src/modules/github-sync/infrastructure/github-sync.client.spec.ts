import { Octokit } from '@octokit/rest'
import { GitHubSyncClient } from './github-sync.client'

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))

const REPOSITORY = {
	id: 456,
	node_id: 'repository-node',
	owner: {
		id: 9,
		node_id: 'organization-node',
		login: 'tessera-org',
		type: 'Organization',
	},
	name: 'notes',
	full_name: 'tessera-org/notes',
	html_url: 'https://github.com/tessera-org/notes',
	clone_url: 'https://github.com/tessera-org/notes.git',
	default_branch: 'main',
}

function createPullRequest(number: number, updatedAt: string) {
	return {
		id: number,
		node_id: `pull-request-${number}`,
		number,
		html_url: `https://github.com/tessera-org/notes/pull/${number}`,
		title: `Pull request ${number}`,
		body: null,
		state: 'open',
		draft: false,
		user: {
			id: 7,
			node_id: 'user-node',
			login: 'marta',
			type: 'User',
		},
		merged_at: null,
		merged_by: null,
		merge_commit_sha: null,
		created_at: '2026-07-20T00:00:00Z',
		updated_at: updatedAt,
		closed_at: null,
		head: {
			ref: `feature-${number}`,
			sha: `head-${number}`,
			repo: { node_id: 'repository-node' },
		},
		base: {
			ref: 'main',
			sha: 'base-sha',
			repo: { node_id: 'repository-node' },
		},
	}
}

describe(GitHubSyncClient.name, () => {
	const request = vi.fn()
	const paginate = vi.fn()
	const list = vi.fn()
	const get = vi.fn()
	const listComments = vi.fn()
	const listReviewComments = vi.fn()
	const listReviews = vi.fn()
	const listRequestedReviewers = vi.fn()
	const graphql = vi.fn()

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-29T12:00:00.500Z'))
		request.mockResolvedValue({
			data: REPOSITORY,
			headers: { date: 'Wed, 29 Jul 2026 12:00:00 GMT' },
		})
		vi.mocked(Octokit).mockImplementation(
			class {
				request = request
				paginate = paginate
				graphql = graphql
				rest = {
					issues: { listComments },
					pulls: {
						list,
						get,
						listReviewComments,
						listReviews,
						listRequestedReviewers,
					},
				}
			} as never
		)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	test('stops pagination after the persisted update cursor', async () => {
		paginate.mockImplementation((_endpoint, _options, mapPage) => {
			const done = vi.fn()
			const pullRequests = mapPage(
				{
					data: [
						createPullRequest(2, '2026-07-29T11:00:00Z'),
						createPullRequest(1, '2026-07-28T11:00:00Z'),
					],
				},
				done
			)

			expect(done).toHaveBeenCalledOnce()

			return pullRequests
		})

		const client = new GitHubSyncClient()
		const reconciliation = await client.getRepositoryReconciliation({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
			updatedAfter: new Date('2026-07-29T00:00:00Z'),
		})

		expect(reconciliation.pullRequests).toEqual([
			expect.objectContaining({ number: 2 }),
		])
		expect(reconciliation.pullRequestCursorAt).toEqual(
			new Date('2026-07-29T12:00:00Z')
		)
		expect(paginate).toHaveBeenCalledWith(
			list,
			expect.objectContaining({ sort: 'updated', direction: 'desc' }),
			expect.any(Function)
		)
		expect(get).not.toHaveBeenCalled()
	})

	test('includes updates from the same provider-clock second', async () => {
		paginate.mockImplementation((_endpoint, _options, mapPage) =>
			mapPage(
				{
					data: [createPullRequest(3, '2026-07-29T12:00:00Z')],
				},
				vi.fn()
			)
		)

		const client = new GitHubSyncClient()
		const reconciliation = await client.getRepositoryReconciliation({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
			updatedAfter: new Date('2026-07-29T12:00:00Z'),
		})

		expect(reconciliation.pullRequests).toEqual([
			expect.objectContaining({ number: 3 }),
		])
	})

	test('paginates and maps the complete pull request conversation', async () => {
		paginate.mockImplementation(endpoint => {
			if (endpoint === listComments)
				return Promise.resolve([
					{
						id: 1,
						node_id: 'issue-comment-node',
						html_url: 'https://github.com/org/repo/issues/7#issuecomment-1',
						body: 'Issue comment',
						user: actor('issue-author', 11),
						created_at: '2026-08-08T10:00:00Z',
						updated_at: '2026-08-08T11:00:00Z',
					},
				])
			if (endpoint === listReviewComments)
				return Promise.resolve([
					{
						id: 2,
						node_id: 'review-comment-node',
						html_url: 'https://github.com/org/repo/pull/7#discussion_r2',
						body: 'Inline',
						user: actor('comment-author', 12),
						pull_request_review_id: 3,
						in_reply_to_id: null,
						subject_type: 'line',
						path: 'src/index.ts',
						side: 'RIGHT',
						line: 9,
						original_line: 8,
						start_side: null,
						start_line: null,
						original_start_line: null,
						commit_id: 'head',
						original_commit_id: 'original-head',
						diff_hunk: '@@ -8 +9 @@\n+value',
						created_at: '2026-08-08T10:00:00Z',
						updated_at: '2026-08-08T10:00:00Z',
					},
				])
			if (endpoint === listReviews)
				return Promise.resolve([
					{
						id: 3,
						node_id: 'pending-review-node',
						html_url: 'https://github.com/org/repo/pull/7#review-3',
						body: null,
						user: actor('pending-reviewer', 13),
						state: 'PENDING',
						commit_id: 'head',
						submitted_at: null,
					},
					{
						id: 4,
						node_id: 'review-node',
						html_url: 'https://github.com/org/repo/pull/7#review-4',
						body: 'Looks good',
						user: actor('reviewer', 14),
						state: 'APPROVED',
						commit_id: 'head',
						submitted_at: '2026-08-08T10:00:00Z',
					},
				])
			throw new Error('unexpected pagination endpoint')
		})
		listRequestedReviewers.mockResolvedValue({
			data: {
				users: [actor('requested-user', 15)],
				teams: [
					{
						id: 16,
						node_id: 'team-node',
						slug: 'platform',
						name: 'Platform',
						html_url: 'https://github.com/orgs/org/teams/platform',
					},
				],
			},
		})
		graphql
			.mockResolvedValueOnce({
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: true, endCursor: 'next' },
							nodes: [reviewThread('thread-1', true)],
						},
					},
				},
			})
			.mockResolvedValueOnce({
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: false, endCursor: null },
							nodes: [reviewThread('thread-2', false)],
						},
					},
				},
			})

		expect(
			await new GitHubSyncClient().getPullRequestConversation({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				pullRequestNumber: 7,
			})
		).toMatchObject({
			issueComments: [{ nodeId: 'issue-comment-node', body: 'Issue comment' }],
			reviewComments: [
				{ nodeId: 'review-comment-node', side: 'right', originalLine: 8 },
			],
			reviews: [{ nodeId: 'review-node', outcome: 'approve' }],
			requestedReviewers: [
				{ kind: 'user', actor: { nodeId: 'requested-user-node' } },
				{ kind: 'team', nodeId: 'team-node', slug: 'platform' },
			],
			reviewThreads: [
				{ nodeId: 'thread-1', resolved: true, side: 'right' },
				{ nodeId: 'thread-2', resolved: false, side: 'right' },
			],
		})
		expect(paginate).toHaveBeenCalledTimes(3)
		expect(graphql).toHaveBeenNthCalledWith(
			2,
			expect.any(String),
			expect.objectContaining({ cursor: 'next' })
		)
	})

	test('fails rather than truncating when a thread page omits the pull request', async () => {
		paginate.mockResolvedValue([])
		listRequestedReviewers.mockResolvedValue({ data: { users: [], teams: [] } })
		graphql
			.mockResolvedValueOnce({
				repository: {
					pullRequest: {
						reviewThreads: {
							pageInfo: { hasNextPage: true, endCursor: 'next' },
							nodes: [reviewThread('thread-1', true)],
						},
					},
				},
			})
			.mockResolvedValueOnce({ repository: { pullRequest: null } })

		await expect(
			new GitHubSyncClient().getPullRequestConversation({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				pullRequestNumber: 7,
			})
		).rejects.toThrow('GitHub synchronization failed')
	})

	test('reads an empty thread connection as an answer', async () => {
		paginate.mockResolvedValue([])
		listRequestedReviewers.mockResolvedValue({ data: { users: [], teams: [] } })
		graphql.mockResolvedValue({
			repository: {
				pullRequest: {
					reviewThreads: {
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: [],
					},
				},
			},
		})

		expect(
			await new GitHubSyncClient().getPullRequestConversation({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				pullRequestNumber: 7,
			})
		).toMatchObject({ reviewThreads: [] })
	})
})

function actor(login: string, id: number) {
	return {
		id,
		node_id: `${login}-node`,
		login,
		type: 'User',
		avatar_url: null,
		html_url: null,
	}
}

function reviewThread(nodeId: string, resolved: boolean) {
	return {
		id: nodeId,
		isResolved: resolved,
		isOutdated: false,
		subjectType: 'LINE',
		path: 'src/index.ts',
		line: 9,
		diffSide: 'RIGHT',
		resolvedBy: null,
		comments: {
			nodes: [
				{
					id: `${nodeId}-comment`,
					replyTo: null,
					originalCommit: { oid: 'head' },
				},
			],
		},
	}
}

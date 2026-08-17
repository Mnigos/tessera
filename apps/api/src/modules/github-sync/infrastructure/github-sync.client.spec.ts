import { Octokit } from '@octokit/rest'
import { isSecretFree } from '~/shared/test-utils'
import { GitHubSyncClient } from './github-sync.client'

type ResponseObserver = (response: { headers: Record<string, string> }) => void

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
	const listSuitesForRef = vi.fn()
	const listForSuite = vi.fn()
	const listForRef = vi.fn()
	const listCommitStatusesForRef = vi.fn()
	const getCombinedStatusForRef = vi.fn()
	const graphql = vi.fn()
	let responseObservers: ResponseObserver[] = []

	/** Replays a GitHub response through whatever the client hooked onto it. */
	function observeResponse(headers: Record<string, string>) {
		for (const observe of responseObservers) observe({ headers })
	}

	beforeEach(() => {
		responseObservers = []
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
				// The client reads the installation's budget from every response
				// through this hook, so the fake records the observers and the tests
				// that care about rate limiting feed them a response.
				hook = {
					after: (_event: string, observer: ResponseObserver) => {
						responseObservers.push(observer)
					},
				}
				rest = {
					issues: { listComments },
					pulls: {
						list,
						get,
						listReviewComments,
						listReviews,
						listRequestedReviewers,
					},
					checks: { listSuitesForRef, listForSuite, listForRef },
					repos: { listCommitStatusesForRef, getCombinedStatusForRef },
				}
			} as never
		)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	test('stops pagination after the persisted update cursor', async () => {
		graphql.mockResolvedValue({ repository: {} })
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
		graphql.mockResolvedValue({ repository: {} })
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

	test('attaches the diff totals GitHub reports for the reconciled pull requests', async () => {
		paginate.mockResolvedValue([
			createPullRequest(2, '2026-07-29T11:00:00Z'),
			createPullRequest(3, '2026-07-29T11:30:00Z'),
		])
		graphql.mockResolvedValue({
			repository: {
				pr2: { additions: 12, deletions: 3, changedFiles: 2 },
				pr3: null,
			},
		})

		const { pullRequests } =
			await new GitHubSyncClient().getRepositoryReconciliation({
				accessToken: 'installation-token',
				externalRepositoryId: 456n,
			})

		expect(pullRequests).toMatchObject([
			{ number: 2, additions: 12, deletions: 3, changedFiles: 2 },
			{ number: 3 },
		])
		expect(pullRequests[1]?.additions).toBeUndefined()
		// One query covers the whole page rather than one request per pull request.
		expect(graphql).toHaveBeenCalledOnce()
		expect(graphql).toHaveBeenCalledWith(
			expect.stringContaining('pr2: pullRequest(number: 2)'),
			{ owner: 'tessera-org', name: 'notes' }
		)
	})

	test('reconciles without diff totals when the stats query fails', async () => {
		paginate.mockResolvedValue([createPullRequest(2, '2026-07-29T11:00:00Z')])
		graphql.mockRejectedValue(new Error('graphql unavailable'))

		const { pullRequests } =
			await new GitHubSyncClient().getRepositoryReconciliation({
				accessToken: 'installation-token',
				externalRepositoryId: 456n,
			})

		expect(pullRequests).toMatchObject([{ number: 2 }])
		expect(pullRequests[0]?.additions).toBeUndefined()
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

	test('reads every suite, its runs, and the posted statuses for a commit', async () => {
		paginate.mockImplementation((endpoint, options) => {
			if (endpoint === listSuitesForRef)
				return Promise.resolve([checkSuite(41), checkSuite(42)])
			if (endpoint === listForSuite)
				return Promise.resolve([
					checkRun(Number(options.check_suite_id) * 10, options.check_suite_id),
				])
			if (endpoint === listCommitStatusesForRef)
				return Promise.resolve([
					{
						id: 33,
						node_id: 'status-node',
						context: 'ci/lint',
						state: 'success',
						target_url: 'https://ci.example.com/lint',
						description: 'Lint passed',
						creator: actor('status-author', 17),
						created_at: '2026-08-08T10:00:00Z',
						updated_at: '2026-08-08T10:00:00Z',
					},
				])
			throw new Error('unexpected pagination endpoint')
		})

		const snapshot = await new GitHubSyncClient().getChecksForRef({
			accessToken: 'installation-token',
			owner: 'org',
			repo: 'repo',
			ref: 'head-sha',
		})

		expect(snapshot).toMatchObject({
			sha: 'head-sha',
			suites: [{ numericId: 41n }, { numericId: 42n }],
			runs: [
				{
					numericId: 410n,
					suiteNumericId: 41n,
					name: 'build',
					status: 'completed',
					conclusion: 'success',
					app: { slug: 'github-actions', numericId: 15368n },
				},
				{ numericId: 420n, suiteNumericId: 42n },
			],
			statuses: [
				{
					numericId: 33n,
					context: 'ci/lint',
					state: 'success',
					creator: { login: 'status-author' },
				},
			],
		})
		expect(paginate).toHaveBeenCalledWith(
			listForSuite,
			expect.objectContaining({ filter: 'all', per_page: 100 })
		)
		expect(listForRef).not.toHaveBeenCalled()
		expect(getCombinedStatusForRef).not.toHaveBeenCalled()
	})

	test('keeps a commit reconcilable when a provider link is malformed', async () => {
		paginate.mockImplementation(endpoint => {
			if (endpoint === listSuitesForRef)
				return Promise.resolve([checkSuite(41)])
			if (endpoint === listForSuite)
				return Promise.resolve([
					{ ...checkRun(410, 41), details_url: 'not-a-url' },
				])
			return Promise.resolve([])
		})

		expect(
			await new GitHubSyncClient().getChecksForRef({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				ref: 'head-sha',
			})
		).toMatchObject({ runs: [{ numericId: 410n, detailsUrl: undefined }] })
	})

	test('marks which listing failed so a pruned suite is not read as a lost commit', async () => {
		const notFound = Object.assign(new Error('Not Found'), { status: 404 })
		paginate.mockImplementation(endpoint => {
			if (endpoint === listSuitesForRef)
				return Promise.resolve([checkSuite(41)])
			if (endpoint === listForSuite) return Promise.reject(notFound)
			return Promise.resolve([])
		})

		await expect(
			new GitHubSyncClient().getChecksForRef({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				ref: 'head-sha',
			})
		).rejects.toMatchObject({
			context: { scope: 'suite', statusCode: 404 },
		})
	})

	test('marks a commit-addressed listing as speaking for the commit itself', async () => {
		const notFound = Object.assign(new Error('Not Found'), { status: 404 })
		paginate.mockImplementation(endpoint =>
			endpoint === listSuitesForRef
				? Promise.reject(notFound)
				: Promise.resolve([])
		)

		await expect(
			new GitHubSyncClient().getChecksForRef({
				accessToken: 'installation-token',
				owner: 'org',
				repo: 'repo',
				ref: 'head-sha',
			})
		).rejects.toMatchObject({ context: { scope: 'ref', statusCode: 404 } })
	})

	test('carries a classification a caller can act on off a failed reconciliation', async () => {
		request.mockRejectedValue(
			Object.assign(new Error('rate limit exceeded'), {
				status: 403,
				response: {
					headers: {
						'x-ratelimit-remaining': '0',
						'x-ratelimit-reset': '1780000000',
						'x-github-request-id': 'ABCD:1234',
					},
				},
			})
		)

		await expect(
			new GitHubSyncClient().getRepositoryReconciliation({
				accessToken: 'installation-token',
				externalRepositoryId: 456n,
			})
		).rejects.toMatchObject({
			context: {
				failureClass: 'rate_limit',
				failureCode: 'rate_limited',
				scope: 'repository',
				statusCode: 403,
				requestId: 'ABCD:1234',
				rateLimitRemaining: 0,
				retryAt: new Date(1_780_000_000_000),
			},
		})
	})

	test('keeps provider headers and bodies out of the error it raises', async () => {
		request.mockRejectedValue(
			Object.assign(new Error('Bad credentials'), {
				status: 401,
				response: {
					headers: {
						authorization: 'Bearer ghs_secret-token',
						'set-cookie': 'session=secret',
					},
					data: { message: 'Bad credentials', documentation_url: 'https://x' },
				},
			})
		)

		const promise = new GitHubSyncClient().getRepositoryReconciliation({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
		})

		// The allowlisted context is worth nothing if the error it travels on still
		// carries the whole provider response one property away, so this sweeps the
		// entire thrown object rather than just its context.
		await expect(promise).rejects.toSatisfy(
			(error: Error) =>
				error.cause === undefined &&
				isSecretFree(error, [
					'ghs_secret-token',
					'session=secret',
					'Bad credentials',
				])
		)
	})

	test('reports the budget a successful reconciliation observed', async () => {
		paginate.mockImplementation(() => {
			observeResponse({
				'x-ratelimit-remaining': '4321',
				'x-ratelimit-reset': '1780000000',
			})

			return Promise.resolve([])
		})

		expect(
			(
				await new GitHubSyncClient().getRepositoryReconciliation({
					accessToken: 'installation-token',
					externalRepositoryId: 456n,
				})
			).rateLimit
		).toEqual({ remaining: 4321, resetAt: new Date(1_780_000_000_000) })
	})

	// A listing deep inside a paginated read is as good a warning as the first
	// response, and the tightest budget seen is the one the next repository
	// under this installation will run into.
	test('keeps the tightest budget any response reported', async () => {
		paginate.mockImplementation(() => {
			observeResponse({ 'x-ratelimit-remaining': '900' })
			observeResponse({ 'x-ratelimit-remaining': '12' })
			observeResponse({ 'x-ratelimit-remaining': '400' })

			return Promise.resolve([])
		})

		expect(
			(
				await new GitHubSyncClient().getRepositoryReconciliation({
					accessToken: 'installation-token',
					externalRepositoryId: 456n,
				})
			).rateLimit
		).toMatchObject({ remaining: 12 })
	})

	// `Number('')` and `Number(null)` are both zero, and zero means an exhausted
	// budget — so a header carrying nothing would defer the installation.
	test.each([
		['an empty header', ''],
		['a blank header', '   '],
		['a header GitHub omitted', undefined],
		['a header that is not a number', 'unknown'],
	])('reports no budget from %s', async (_name, remaining) => {
		paginate.mockImplementation(() => {
			observeResponse(
				remaining === undefined ? {} : { 'x-ratelimit-remaining': remaining }
			)

			return Promise.resolve([])
		})

		expect(
			(
				await new GitHubSyncClient().getRepositoryReconciliation({
					accessToken: 'installation-token',
					externalRepositoryId: 456n,
				})
			).rateLimit
		).toBeUndefined()
	})

	test('reports the budget a checks read observed', async () => {
		paginate.mockImplementation(() => {
			observeResponse({ 'x-ratelimit-remaining': '0' })

			return Promise.resolve([])
		})

		expect(
			(
				await new GitHubSyncClient().getChecksForRef({
					accessToken: 'installation-token',
					owner: 'org',
					repo: 'repo',
					ref: 'head-sha',
				})
			).rateLimit
		).toMatchObject({ remaining: 0 })
	})
})

function checkApp() {
	return {
		id: 15_368,
		node_id: 'app-node',
		slug: 'github-actions',
		name: 'GitHub Actions',
		html_url: 'https://github.com/apps/github-actions',
	}
}

function checkSuite(id: number) {
	return {
		id,
		node_id: `check-suite-${id}`,
		head_sha: 'head-sha',
		status: 'completed',
		conclusion: 'success',
		app: checkApp(),
		created_at: '2026-08-08T10:00:00Z',
		updated_at: '2026-08-08T10:05:00Z',
	}
}

function checkRun(id: number, suiteId: number) {
	return {
		id,
		node_id: `check-run-${id}`,
		head_sha: 'head-sha',
		name: 'build',
		status: 'completed',
		conclusion: 'success',
		external_id: `external-${id}`,
		details_url: 'https://github.com/org/repo/actions/runs/1',
		html_url: 'https://github.com/org/repo/runs/1',
		output: { title: 'Build passed', summary: 'All green' },
		check_suite: { id: suiteId, node_id: `check-suite-${suiteId}` },
		app: checkApp(),
		started_at: '2026-08-08T10:00:00Z',
		completed_at: '2026-08-08T10:05:00Z',
	}
}

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

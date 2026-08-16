import { Octokit } from '@octokit/rest'
import {
	GitHubResponseUnreadableError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'
import { GitHubUserWriteClient } from './github-user-write.client'

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))

const TARGET = {
	accessToken: 'user-token',
	owner: 'tessera-org',
	repo: 'notes',
}
const PULL_REQUEST_TARGET = { ...TARGET, pullRequestNumber: 17 }
const CREATED_AT = '2026-08-16T10:00:00Z'
const UPDATED_AT = '2026-08-16T11:00:00Z'
const ACTOR = {
	id: 7,
	node_id: 'user-node',
	login: 'marta',
	type: 'User',
	avatar_url: 'https://avatars.githubusercontent.com/u/7',
	html_url: 'https://github.com/marta',
}

function issueComment(overrides: Record<string, unknown> = {}) {
	return {
		id: 101,
		node_id: 'issue-comment-node',
		html_url: 'https://github.com/tessera-org/notes/issues/17#issuecomment-101',
		body: null,
		user: ACTOR,
		created_at: CREATED_AT,
		updated_at: UPDATED_AT,
		...overrides,
	}
}

function reviewComment(overrides: Record<string, unknown> = {}) {
	return {
		id: 201,
		node_id: 'review-comment-node',
		html_url: 'https://github.com/tessera-org/notes/pull/17#discussion_r201',
		body: 'Inline comment',
		user: ACTOR,
		pull_request_review_id: 301,
		in_reply_to_id: 200,
		subject_type: 'line',
		path: 'src/index.ts',
		side: 'RIGHT',
		line: 9,
		original_line: null,
		start_side: 'LEFT',
		start_line: 7,
		original_start_line: null,
		commit_id: 'head-sha',
		original_commit_id: null,
		diff_hunk: null,
		created_at: CREATED_AT,
		updated_at: UPDATED_AT,
		...overrides,
	}
}

function review(overrides: Record<string, unknown> = {}) {
	return {
		id: 301,
		node_id: 'review-node',
		html_url:
			'https://github.com/tessera-org/notes/pull/17#pullrequestreview-301',
		body: null,
		user: ACTOR,
		state: 'APPROVED',
		commit_id: null,
		submitted_at: CREATED_AT,
		...overrides,
	}
}

function pullRequest(overrides: Record<string, unknown> = {}) {
	return {
		id: 401,
		node_id: 'pull-request-node',
		number: 17,
		html_url: 'https://github.com/tessera-org/notes/pull/17',
		title: 'Feature',
		body: null,
		state: 'closed',
		draft: null,
		user: ACTOR,
		merged_at: CREATED_AT,
		merged_by: {
			...ACTOR,
			id: 8,
			node_id: 'merger-node',
			login: 'octo-merger',
		},
		merge_commit_sha: 'merge-sha',
		created_at: '2026-08-15T10:00:00Z',
		updated_at: UPDATED_AT,
		closed_at: CREATED_AT,
		head: {
			ref: 'feature',
			sha: 'head-sha',
			repo: null,
		},
		base: {
			ref: 'main',
			sha: 'base-sha',
			repo: { node_id: 'repository-node' },
		},
		...overrides,
	}
}

describe(GitHubUserWriteClient.name, () => {
	const createIssueComment = vi.fn()
	const updateIssueComment = vi.fn()
	const deleteIssueComment = vi.fn()
	const createReviewComment = vi.fn()
	const createReplyForReviewComment = vi.fn()
	const updateReviewComment = vi.fn()
	const deleteReviewComment = vi.fn()
	const createReview = vi.fn()
	const requestReviewers = vi.fn()
	const removeRequestedReviewers = vi.fn()
	const updatePullRequest = vi.fn()
	const mergePullRequest = vi.fn()
	const getPullRequest = vi.fn()
	const graphql = vi.fn()

	beforeEach(() => {
		createIssueComment.mockResolvedValue({ data: issueComment() })
		updateIssueComment.mockResolvedValue({ data: issueComment() })
		deleteIssueComment.mockResolvedValue({ data: undefined })
		createReviewComment.mockResolvedValue({ data: reviewComment() })
		createReplyForReviewComment.mockResolvedValue({ data: reviewComment() })
		updateReviewComment.mockResolvedValue({ data: reviewComment() })
		deleteReviewComment.mockResolvedValue({ data: undefined })
		createReview.mockResolvedValue({ data: review() })
		requestReviewers.mockResolvedValue({ data: {} })
		removeRequestedReviewers.mockResolvedValue({ data: {} })
		updatePullRequest.mockResolvedValue({ data: pullRequest() })
		mergePullRequest.mockResolvedValue({
			data: { merged: true, sha: 'merge-sha' },
		})
		getPullRequest.mockResolvedValue({ data: pullRequest() })
		graphql.mockResolvedValue({})
		vi.mocked(Octokit).mockImplementation(
			class {
				graphql = graphql
				rest = {
					issues: {
						createComment: createIssueComment,
						updateComment: updateIssueComment,
						deleteComment: deleteIssueComment,
					},
					pulls: {
						createReviewComment,
						createReplyForReviewComment,
						updateReviewComment,
						deleteReviewComment,
						createReview,
						requestReviewers,
						removeRequestedReviewers,
						update: updatePullRequest,
						merge: mergePullRequest,
						get: getPullRequest,
					},
				}
			} as never
		)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('creates a line review comment without the deprecated position field', async () => {
		const client = new GitHubUserWriteClient()

		expect(
			await client.createReviewComment({
				...PULL_REQUEST_TARGET,
				body: 'Please rename this',
				headSha: 'head-sha',
				anchor: {
					path: 'src/index.ts',
					side: 'left',
					startLine: 9,
					endLine: 9,
					anchorSha: 'anchor-sha',
					baseSha: 'base-sha',
					headSha: 'head-sha',
					lineExcerpt: 'const value = 1',
				},
			})
		).toMatchObject({
			nodeId: 'review-comment-node',
			numericId: 201n,
			reviewNumericId: 301n,
			inReplyToNumericId: 200n,
			subjectType: 'line',
			path: 'src/index.ts',
			side: 'right',
			line: 9,
			startSide: 'left',
			startLine: 7,
			originalLine: undefined,
			originalStartLine: undefined,
			commitId: 'head-sha',
			originalCommitId: undefined,
			diffHunk: undefined,
			author: {
				nodeId: 'user-node',
				numericId: 7n,
				login: 'marta',
				type: 'user',
				avatarUrl: 'https://avatars.githubusercontent.com/u/7',
				htmlUrl: 'https://github.com/marta',
			},
		})
		expect(createReviewComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			body: 'Please rename this',
			commit_id: 'head-sha',
			path: 'src/index.ts',
			side: 'LEFT',
			line: 9,
		})
		expect(createReviewComment.mock.calls[0]?.[0]).not.toHaveProperty(
			'position'
		)
		expect(Octokit).toHaveBeenCalledWith({ auth: TARGET.accessToken })
	})

	test('sends GitHub range fields only for a real range', async () => {
		await new GitHubUserWriteClient().createReviewComment({
			...PULL_REQUEST_TARGET,
			body: 'Review this range',
			headSha: 'resolved-head-sha',
			anchor: {
				path: 'src/index.ts',
				side: 'right',
				startLine: 7,
				endLine: 9,
				anchorSha: 'anchor-sha',
				baseSha: 'base-sha',
				headSha: 'claimed-head-sha',
				lineExcerpt: 'const value = 1',
			},
		})

		expect(createReviewComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			body: 'Review this range',
			commit_id: 'resolved-head-sha',
			path: 'src/index.ts',
			side: 'RIGHT',
			line: 9,
			start_line: 7,
			start_side: 'RIGHT',
		})
	})

	test('replies to the numeric root review comment', async () => {
		const client = new GitHubUserWriteClient()

		await client.createReplyForReviewComment({
			...PULL_REQUEST_TARGET,
			body: 'Agreed',
			rootCommentNumericId: 201n,
		})

		expect(createReplyForReviewComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			comment_id: 201,
			body: 'Agreed',
		})
	})

	test.each([
		['approve', 'APPROVE'],
		['request_changes', 'REQUEST_CHANGES'],
		['comment', 'COMMENT'],
	] as const)('maps %s to the GitHub review event', async (outcome, event) => {
		createReview.mockResolvedValue({
			data: review({
				state:
					outcome === 'approve'
						? 'APPROVED'
						: outcome === 'request_changes'
							? 'CHANGES_REQUESTED'
							: 'COMMENTED',
			}),
		})

		expect(
			await new GitHubUserWriteClient().createReview({
				...PULL_REQUEST_TARGET,
				body: 'Review body',
				expectedHeadSha: 'head-sha',
				outcome,
			})
		).toMatchObject({ outcome, body: '', commitId: undefined })
		expect(createReview).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			commit_id: 'head-sha',
			event,
			body: 'Review body',
		})
	})

	test('requests and removes a user reviewer', async () => {
		const client = new GitHubUserWriteClient()
		const params = { ...PULL_REQUEST_TARGET, reviewerLogin: 'reviewer' }

		await client.requestReviewer(params)
		await client.removeRequestedReviewer(params)

		expect(requestReviewers).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			reviewers: ['reviewer'],
		})
		expect(removeRequestedReviewers).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			reviewers: ['reviewer'],
		})
	})

	test('updates all supported pull request fields and maps merged nulls', async () => {
		const client = new GitHubUserWriteClient()

		expect(
			await client.updatePullRequest({
				...PULL_REQUEST_TARGET,
				title: 'Updated',
				body: 'Body',
				targetBranch: 'release',
				state: 'closed',
			})
		).toMatchObject({
			nodeId: 'pull-request-node',
			numericId: 401n,
			state: 'merged',
			draft: false,
			body: '',
			mergeCommitSha: 'merge-sha',
			mergedBy: {
				nodeId: 'merger-node',
				numericId: 8n,
				login: 'octo-merger',
			},
			headRepositoryNodeId: undefined,
			closedAt: new Date(CREATED_AT),
			mergedAt: new Date(CREATED_AT),
		})
		expect(updatePullRequest).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			title: 'Updated',
			body: 'Body',
			base: 'release',
			state: 'closed',
		})
	})

	test.each([
		['merge_commit', 'merge'],
		['squash', 'squash'],
		['rebase', 'rebase'],
	] as const)('maps %s to merge method %s', async (strategy, mergeMethod) => {
		expect(
			await new GitHubUserWriteClient().mergePullRequest({
				...PULL_REQUEST_TARGET,
				expectedHeadSha: 'expected-head',
				strategy,
			})
		).toBe('merge-sha')
		expect(mergePullRequest).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
			sha: 'expected-head',
			merge_method: mergeMethod,
		})
	})

	test.each([
		['a sha', { merged: false, sha: 'unused' }],
		['no sha', { merged: false }],
	])('rejects a successful HTTP response where GitHub declined the merge with %s', async (_name, data) => {
		mergePullRequest.mockResolvedValue({ data })

		await expect(
			new GitHubUserWriteClient().mergePullRequest({
				...PULL_REQUEST_TARGET,
				expectedHeadSha: 'expected-head',
				strategy: 'squash',
			})
		).rejects.toMatchObject({
			constructor: GitHubWriteRejectedError,
			reason: 'unmergeable',
		})
	})

	test('creates, edits, and deletes issue comments with issue REST methods', async () => {
		const client = new GitHubUserWriteClient()

		expect(
			await client.createIssueComment({
				...PULL_REQUEST_TARGET,
				body: 'Top level',
			})
		).toMatchObject({
			nodeId: 'issue-comment-node',
			numericId: 101n,
			body: '',
			createdAt: new Date(CREATED_AT),
			updatedAt: new Date(UPDATED_AT),
		})
		await client.updateIssueComment({
			...TARGET,
			commentNumericId: 101n,
			body: 'Edited',
		})
		await client.deleteIssueComment({
			...TARGET,
			commentNumericId: 101n,
		})

		expect(createIssueComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			issue_number: 17,
			body: 'Top level',
		})
		expect(updateIssueComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			comment_id: 101,
			body: 'Edited',
		})
		expect(deleteIssueComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			comment_id: 101,
		})
	})

	test('edits and deletes review comments with pull request REST methods', async () => {
		const client = new GitHubUserWriteClient()

		await client.updateReviewComment({
			...TARGET,
			commentNumericId: 201n,
			body: 'Edited',
		})
		await client.deleteReviewComment({
			...TARGET,
			commentNumericId: 201n,
		})

		expect(updateReviewComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			comment_id: 201,
			body: 'Edited',
		})
		expect(deleteReviewComment).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			comment_id: 201,
		})
	})

	test('resolves and unresolves review threads through the GraphQL mutations', async () => {
		const client = new GitHubUserWriteClient()
		const params = { ...TARGET, threadNodeId: 'thread-node' }

		await client.resolveReviewThread(params)
		await client.unresolveReviewThread(params)

		expect(graphql).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining('resolveReviewThread(input:'),
			{ threadId: 'thread-node' }
		)
		expect(graphql).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('unresolveReviewThread(input:'),
			{ threadId: 'thread-node' }
		)
	})

	test('gets and maps a pull request response', async () => {
		expect(
			await new GitHubUserWriteClient().getPullRequest(PULL_REQUEST_TARGET)
		).toMatchObject({
			nodeId: 'pull-request-node',
			mergeCommitSha: 'merge-sha',
			mergedBy: { login: 'octo-merger' },
		})
		expect(getPullRequest).toHaveBeenCalledWith({
			owner: TARGET.owner,
			repo: TARGET.repo,
			pull_number: 17,
		})
	})

	test.each([
		[
			'issue comment',
			() =>
				createIssueComment.mockResolvedValue({
					data: issueComment({ user: null }),
				}),
			() =>
				new GitHubUserWriteClient().createIssueComment({
					...PULL_REQUEST_TARGET,
					body: 'Comment',
				}),
		],
		[
			'review',
			() => createReview.mockResolvedValue({ data: review({ user: null }) }),
			() =>
				new GitHubUserWriteClient().createReview({
					...PULL_REQUEST_TARGET,
					body: '',
					expectedHeadSha: 'head-sha',
					outcome: 'approve',
				}),
		],
	] as const)('marks an accepted %s with a null user as unreadable', async (_name, arrange, act) => {
		arrange()

		await expect(act()).rejects.toBeInstanceOf(GitHubResponseUnreadableError)
	})
})

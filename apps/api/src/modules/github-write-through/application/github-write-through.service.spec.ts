import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
} from '@repo/contracts'
import type {
	GitHubActorId,
	GitHubPullRequestMappingId,
	GitHubPullRequestThreadMappingId,
	PullRequestReviewSubmissionId,
} from '@repo/db'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestReviewerRequestId,
	PullRequestReviewId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import {
	GitHubReconnectRequiredError,
	GitHubResponseUnreadableError,
	GitHubSyncDelayedError,
	GitHubUnavailableError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'
import { GitHubUserWriteClient } from '../infrastructure/github-user-write.client'
import {
	type GitHubPullRequestWriteTarget,
	GitHubWriteThroughRepository,
} from '../infrastructure/github-write-through.repository'
import {
	type GitHubWriteThroughContext,
	GitHubWriteThroughService,
} from './github-write-through.service'

const ACTOR_USER_ID = '00000000-0000-4000-8000-000000000001' as UserId
const REVIEWER_USER_ID = '00000000-0000-4000-8000-000000000002' as UserId
const REPOSITORY_ID = '00000000-0000-4000-8000-000000000003' as RepositoryId
const PULL_REQUEST_ID = '00000000-0000-4000-8000-000000000004' as PullRequestId
const THREAD_ID = '00000000-0000-4000-8000-000000000005' as PullRequestThreadId
const COMMENT_ID =
	'00000000-0000-4000-8000-000000000006' as PullRequestCommentId
const REVIEW_ID = '00000000-0000-4000-8000-000000000007' as PullRequestReviewId
const REVIEWER_REQUEST_ID =
	'00000000-0000-4000-8000-000000000008' as PullRequestReviewerRequestId
const THREAD_MAPPING_ID =
	'00000000-0000-4000-8000-000000000009' as GitHubPullRequestThreadMappingId
const ACTOR_ID = '00000000-0000-4000-8000-000000000010' as GitHubActorId
const TARGET: GitHubPullRequestWriteTarget = {
	pullRequestMappingId:
		'00000000-0000-4000-8000-000000000011' as GitHubPullRequestMappingId,
	externalNodeId: 'pull-request-node',
	externalNumber: 17,
	headSha: null,
}
const CONTEXT: GitHubWriteThroughContext = {
	actorUserId: ACTOR_USER_ID,
	externalRepository: { ownerLogin: 'tessera-org', name: 'notes' },
	pullRequestId: PULL_REQUEST_ID,
	repositoryId: REPOSITORY_ID,
}
const CLIENT_TARGET = {
	accessToken: 'user-token',
	owner: 'tessera-org',
	repo: 'notes',
	pullRequestNumber: 17,
	target: TARGET,
}
const ECHO_TARGET = {
	actorUserId: ACTOR_USER_ID,
	pullRequestId: PULL_REQUEST_ID,
	repositoryId: REPOSITORY_ID,
	target: TARGET,
}
const CREATED_AT = new Date('2026-08-16T10:00:00Z')
const UPDATED_AT = new Date('2026-08-16T11:00:00Z')
const AUTHOR = {
	nodeId: 'actor-node',
	numericId: 7n,
	login: 'marta',
	type: 'user' as const,
}
const ISSUE_COMMENT = {
	nodeId: 'issue-comment-node',
	numericId: 101n,
	author: AUTHOR,
	body: 'Top level',
	htmlUrl: 'https://github.com/tessera-org/notes/issues/17#issuecomment-101',
	createdAt: CREATED_AT,
	updatedAt: UPDATED_AT,
}
const REVIEW_COMMENT = {
	nodeId: 'review-comment-node',
	numericId: 201n,
	author: AUTHOR,
	body: 'Inline',
	htmlUrl: 'https://github.com/tessera-org/notes/pull/17#discussion_r201',
	reviewNumericId: 301n,
	subjectType: 'line' as const,
	path: 'src/confirmed.ts',
	side: 'left' as const,
	line: 11,
	commitId: 'confirmed-head',
	createdAt: CREATED_AT,
	updatedAt: UPDATED_AT,
}
const REVIEW = {
	nodeId: 'review-node',
	numericId: 301n,
	reviewer: AUTHOR,
	body: '',
	outcome: 'approve' as const,
	dismissed: false,
	htmlUrl: 'https://github.com/tessera-org/notes/pull/17#pullrequestreview-301',
	commitId: 'reviewed-head',
	submittedAt: CREATED_AT,
}
const PULL_REQUEST = {
	nodeId: 'pull-request-node',
	numericId: 401n,
	number: 17,
	htmlUrl: 'https://github.com/tessera-org/notes/pull/17',
	title: 'Updated',
	body: 'Body',
	state: 'merged' as const,
	draft: false,
	labels: [],
	assignees: [],
	author: AUTHOR,
	mergedBy: AUTHOR,
	mergeCommitSha: 'get-merge-sha',
	sourceBranch: 'feature',
	targetBranch: 'main',
	headRepositoryNodeId: 'repository-node',
	baseRepositoryNodeId: 'repository-node',
	headSha: 'head-sha',
	baseSha: 'base-sha',
	createdAt: CREATED_AT,
	updatedAt: UPDATED_AT,
	closedAt: UPDATED_AT,
	mergedAt: UPDATED_AT,
}
const SUBMISSION = {
	id: '00000000-0000-4000-8000-000000000012' as PullRequestReviewSubmissionId,
	createdAt: new Date('2026-08-16T09:00:00Z'),
	externalReviewNodeId: null,
	isUnresolved: false,
}
const ANCHOR = {
	path: 'src/requested.ts',
	side: 'right' as const,
	startLine: 9,
	endLine: 9,
	anchorSha: 'anchor-sha',
	baseSha: 'base-sha',
	headSha: 'head-sha',
	lineExcerpt: 'const value = 1',
}

function hasWriteOrder(
	accountSpy: ReturnType<typeof vi.spyOn>,
	targetSpy: ReturnType<typeof vi.spyOn>,
	clientSpy: ReturnType<typeof vi.spyOn>,
	echoSpy: ReturnType<typeof vi.spyOn>
) {
	const accountOrder = accountSpy.mock.invocationCallOrder[0] ?? 0
	const targetOrder = targetSpy.mock.invocationCallOrder[0] ?? 0
	const clientOrder = clientSpy.mock.invocationCallOrder[0] ?? 0
	const echoOrder = echoSpy.mock.invocationCallOrder[0] ?? 0

	return (
		accountOrder < targetOrder &&
		targetOrder < clientOrder &&
		clientOrder < echoOrder
	)
}

describe(GitHubWriteThroughService.name, () => {
	let moduleRef: TestingModule
	let service: GitHubWriteThroughService
	let client: GitHubUserWriteClient
	let repository: GitHubWriteThroughRepository
	let accountSpy: ReturnType<typeof vi.spyOn>
	let targetSpy: ReturnType<typeof vi.spyOn>

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubWriteThroughService,
				{
					provide: GitHubUserWriteClient,
					useValue: {
						createIssueComment: vi.fn(),
						createReviewComment: vi.fn(),
						createReplyForReviewComment: vi.fn(),
						updateIssueComment: vi.fn(),
						updateReviewComment: vi.fn(),
						deleteIssueComment: vi.fn(),
						deleteReviewComment: vi.fn(),
						resolveReviewThread: vi.fn(),
						unresolveReviewThread: vi.fn(),
						requestReviewer: vi.fn(),
						removeRequestedReviewer: vi.fn(),
						createReview: vi.fn(),
						listReviewComments: vi.fn(),
						listOwnReviewsSince: vi.fn(),
						updatePullRequest: vi.fn(),
						mergePullRequest: vi.fn(),
						getPullRequest: vi.fn(),
					},
				},
				{
					provide: GitHubWriteThroughRepository,
					useValue: {
						findGitHubAccount: vi.fn(),
						findPullRequestTarget: vi.fn(),
						findCommentTarget: vi.fn(),
						findThreadTarget: vi.fn(),
						findUserIdentity: vi.fn(),
						echoIssueComment: vi.fn(),
						echoReviewComment: vi.fn(),
						echoReply: vi.fn(),
						echoCommentEdit: vi.fn(),
						echoCommentDeletion: vi.fn(),
						echoThreadResolution: vi.fn(),
						echoReviewerRequest: vi.fn(),
						echoReviewerRequestRemoval: vi.fn(),
						echoBatchedReview: vi.fn(),
						startReviewSubmission: vi.fn(),
						recordReviewSubmissionPosted: vi.fn(),
						failReviewSubmission: vi.fn(),
						findMappedReviewNodeIds: vi.fn(),
						echoPullRequest: vi.fn(),
						requestSync: vi.fn(),
					},
				},
			],
		}).compile()
		service = moduleRef.get(GitHubWriteThroughService)
		client = moduleRef.get(GitHubUserWriteClient)
		repository = moduleRef.get(GitHubWriteThroughRepository)
		accountSpy = vi.spyOn(repository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'user-token',
			scope: 'read:user,repo',
			accessTokenExpiresAt: null,
		})
		targetSpy = vi
			.spyOn(repository, 'findPullRequestTarget')
			.mockResolvedValue(TARGET)
		vi.spyOn(repository, 'startReviewSubmission').mockResolvedValue(SUBMISSION)
		vi.spyOn(repository, 'recordReviewSubmissionPosted').mockResolvedValue()
		vi.spyOn(repository, 'failReviewSubmission').mockResolvedValue()
		vi.spyOn(client, 'listReviewComments').mockResolvedValue([])
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates and echoes a top-level issue comment', async () => {
		const clientSpy = vi
			.spyOn(client, 'createIssueComment')
			.mockResolvedValue(ISSUE_COMMENT)
		const echoSpy = vi
			.spyOn(repository, 'echoIssueComment')
			.mockResolvedValue(THREAD_ID)

		expect(await service.createThread(CONTEXT, { body: 'Top level' })).toBe(
			THREAD_ID
		)
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: 'Top level',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			comment: ISSUE_COMMENT,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('creates and echoes an inline comment with the requested anchor', async () => {
		const clientSpy = vi
			.spyOn(client, 'createReviewComment')
			.mockResolvedValue(REVIEW_COMMENT)
		const echoSpy = vi
			.spyOn(repository, 'echoReviewComment')
			.mockResolvedValue(THREAD_ID)

		expect(
			await service.createThread(CONTEXT, {
				body: 'Inline',
				inline: { anchor: ANCHOR, headSha: 'resolved-head-sha' },
			})
		).toBe(THREAD_ID)
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			anchor: ANCHOR,
			body: 'Inline',
			headSha: 'resolved-head-sha',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			anchor: ANCHOR,
			comment: REVIEW_COMMENT,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('replies to the mapped root review comment and echoes into its thread', async () => {
		vi.spyOn(repository, 'findThreadTarget').mockResolvedValue({
			threadMappingId: THREAD_MAPPING_ID,
			externalNodeId: 'thread-node',
			rootCommentNumericId: 201n,
		})
		const clientSpy = vi
			.spyOn(client, 'createReplyForReviewComment')
			.mockResolvedValue({ ...REVIEW_COMMENT, inReplyToNumericId: 201n })
		const echoSpy = vi.spyOn(repository, 'echoReply').mockResolvedValue()

		await service.replyThread(CONTEXT, {
			body: 'Agreed',
			threadId: THREAD_ID,
			threadKind: 'inline',
		})

		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: 'Agreed',
			rootCommentNumericId: 201n,
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			comment: { ...REVIEW_COMMENT, inReplyToNumericId: 201n },
			threadId: THREAD_ID,
			threadMappingId: THREAD_MAPPING_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test.each([
		['issue', 'updateIssueComment'],
		['review', 'updateReviewComment'],
	] as const)('edits and echoes a mapped %s comment', async (kind, method) => {
		vi.spyOn(repository, 'findCommentTarget').mockResolvedValue({
			kind,
			externalNumericId: 101n,
		})
		const clientSpy = vi
			.spyOn(client, method)
			.mockResolvedValue(
				kind === 'issue'
					? { ...ISSUE_COMMENT, body: 'Edited' }
					: { ...REVIEW_COMMENT, body: 'Edited' }
			)
		const echoSpy = vi.spyOn(repository, 'echoCommentEdit').mockResolvedValue()

		await service.editComment(CONTEXT, {
			commentId: COMMENT_ID,
			body: 'Edited',
		})

		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: 'Edited',
			commentNumericId: 101n,
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			body: 'Edited',
			commentId: COMMENT_ID,
			updatedAt: UPDATED_AT,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test.each([
		['issue', 'deleteIssueComment'],
		['review', 'deleteReviewComment'],
	] as const)('deletes and echoes a mapped %s comment', async (kind, method) => {
		vi.spyOn(repository, 'findCommentTarget').mockResolvedValue({
			kind,
			externalNumericId: 101n,
		})
		const clientSpy = vi.spyOn(client, method).mockResolvedValue()
		const echoSpy = vi
			.spyOn(repository, 'echoCommentDeletion')
			.mockResolvedValue({ threadDeleted: true })

		expect(
			await service.deleteComment(CONTEXT, {
				commentId: COMMENT_ID,
				threadId: THREAD_ID,
			})
		).toEqual({ threadDeleted: true })
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			commentNumericId: 101n,
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			commentId: COMMENT_ID,
			threadId: THREAD_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test.each([
		[true, 'resolveReviewThread'],
		[false, 'unresolveReviewThread'],
	] as const)('sets inline thread resolution to %s on GitHub and locally', async (resolved, method) => {
		vi.spyOn(repository, 'findThreadTarget').mockResolvedValue({
			threadMappingId: THREAD_MAPPING_ID,
			externalNodeId: 'thread-node',
			rootCommentNumericId: 201n,
		})
		const clientSpy = vi.spyOn(client, method).mockResolvedValue()
		const echoSpy = vi
			.spyOn(repository, 'echoThreadResolution')
			.mockResolvedValue()

		await service.setThreadResolution(CONTEXT, {
			resolved,
			threadId: THREAD_ID,
			threadKind: 'inline',
		})

		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			threadNodeId: 'thread-node',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			resolved,
			threadId: THREAD_ID,
			threadMappingId: THREAD_MAPPING_ID,
			threadNodeId: 'thread-node',
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('requests a mapped GitHub reviewer and echoes the request', async () => {
		const reviewer = {
			actorId: ACTOR_ID,
			externalNodeId: 'reviewer-node',
			externalNumericId: 8n,
			login: 'reviewer',
		}
		vi.spyOn(repository, 'findUserIdentity').mockResolvedValue(reviewer)
		const clientSpy = vi.spyOn(client, 'requestReviewer').mockResolvedValue()
		const echoSpy = vi
			.spyOn(repository, 'echoReviewerRequest')
			.mockResolvedValue(REVIEWER_REQUEST_ID)

		expect(
			await service.requestReviewer(CONTEXT, {
				reviewerUserId: REVIEWER_USER_ID,
			})
		).toBe(REVIEWER_REQUEST_ID)
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			reviewerLogin: 'reviewer',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			reviewer,
			reviewerUserId: REVIEWER_USER_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('removes a mapped GitHub reviewer and echoes the removal', async () => {
		vi.spyOn(repository, 'findUserIdentity').mockResolvedValue({
			actorId: ACTOR_ID,
			externalNodeId: 'reviewer-node',
			externalNumericId: 8n,
			login: 'reviewer',
		})
		const clientSpy = vi
			.spyOn(client, 'removeRequestedReviewer')
			.mockResolvedValue()
		const echoSpy = vi
			.spyOn(repository, 'echoReviewerRequestRemoval')
			.mockResolvedValue(true)

		expect(
			await service.removeReviewerRequest(CONTEXT, {
				reviewerUserId: REVIEWER_USER_ID,
			})
		).toBe(true)
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			reviewerLogin: 'reviewer',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			reviewerUserId: REVIEWER_USER_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('submits and echoes an immediate GitHub review', async () => {
		const clientSpy = vi.spyOn(client, 'createReview').mockResolvedValue(REVIEW)
		const echoSpy = vi
			.spyOn(repository, 'echoBatchedReview')
			.mockResolvedValue(REVIEW_ID)

		expect(
			await service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'expected-head',
				outcome: 'approve',
				pendingCommentCount: 0,
			})
		).toBe(REVIEW_ID)
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: '',
			comments: [],
			expectedHeadSha: 'expected-head',
			outcome: 'approve',
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			comments: [],
			drafts: [],
			headSha: 'expected-head',
			isAdopted: false,
			pendingReviewId: undefined,
			review: REVIEW,
			submissionId: SUBMISSION.id,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('posts every batched draft as one review and reads its comments back', async () => {
		const draft = {
			anchor: ANCHOR,
			body: 'Inline',
			commentId: COMMENT_ID,
			threadId: THREAD_ID,
		}
		const clientSpy = vi.spyOn(client, 'createReview').mockResolvedValue(REVIEW)
		const readBackSpy = vi
			.spyOn(client, 'listReviewComments')
			.mockResolvedValue([REVIEW_COMMENT])
		const echoSpy = vi
			.spyOn(repository, 'echoBatchedReview')
			.mockResolvedValue(REVIEW_ID)

		expect(
			await service.submitReview(CONTEXT, {
				body: 'Summary',
				drafts: [draft],
				expectedHeadSha: 'expected-head',
				outcome: 'comment',
				pendingCommentCount: 1,
				pendingReviewId: REVIEW_ID,
			})
		).toBe(REVIEW_ID)
		expect(clientSpy).toHaveBeenCalledOnce()
		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: 'Summary',
			comments: [draft],
			expectedHeadSha: 'expected-head',
			outcome: 'comment',
		})
		expect(readBackSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			reviewNumericId: REVIEW.numericId,
		})
		expect(echoSpy).toHaveBeenCalledWith({
			...ECHO_TARGET,
			comments: [REVIEW_COMMENT],
			drafts: [draft],
			headSha: 'expected-head',
			isAdopted: false,
			pendingReviewId: REVIEW_ID,
			review: REVIEW,
			submissionId: SUBMISSION.id,
		})
	})

	test('replays a settled submission instead of leaving a second review', async () => {
		vi.spyOn(repository, 'startReviewSubmission').mockResolvedValue({
			...SUBMISSION,
			settledReviewId: REVIEW_ID,
		})

		expect(
			await service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'expected-head',
				outcome: 'approve',
				pendingCommentCount: 0,
			})
		).toBe(REVIEW_ID)
		expect(client.createReview).not.toHaveBeenCalled()
	})

	test('adopts the review a lost attempt already created', async () => {
		vi.spyOn(repository, 'startReviewSubmission').mockResolvedValue({
			...SUBMISSION,
			externalReviewNodeId: REVIEW.nodeId,
			isUnresolved: true,
		})
		vi.spyOn(repository, 'findUserIdentity').mockResolvedValue({
			actorId: ACTOR_ID,
			externalNodeId: 'actor-node',
			externalNumericId: 7n,
			login: 'marta',
		})
		vi.spyOn(client, 'listOwnReviewsSince').mockResolvedValue([
			{ ...REVIEW, commitId: 'expected-head' },
		])
		vi.spyOn(repository, 'findMappedReviewNodeIds').mockResolvedValue(new Set())
		const echoSpy = vi
			.spyOn(repository, 'echoBatchedReview')
			.mockResolvedValue(REVIEW_ID)

		expect(
			await service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'expected-head',
				outcome: 'approve',
				pendingCommentCount: 0,
			})
		).toBe(REVIEW_ID)
		expect(client.createReview).not.toHaveBeenCalled()
		expect(echoSpy).toHaveBeenCalledWith(
			expect.objectContaining({ isAdopted: true })
		)
	})

	test('refuses a submission whose head GitHub has already moved past', async () => {
		targetSpy.mockResolvedValue({ ...TARGET, headSha: 'moved-head' })

		await expect(
			service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'expected-head',
				outcome: 'approve',
				pendingCommentCount: 0,
			})
		).rejects.toMatchObject({
			reason: 'stale_head',
			message: GITHUB_WRITE_REJECTED_MESSAGES.stale_head,
		})
		expect(client.createReview).not.toHaveBeenCalled()
	})

	test('reports an unplaceable batch and keeps the drafts by failing the ledger', async () => {
		vi.spyOn(client, 'createReview').mockRejectedValue(
			new GitHubWriteRejectedError('invalid_anchor')
		)

		await expect(
			service.submitReview(CONTEXT, {
				body: '',
				drafts: [
					{
						anchor: ANCHOR,
						body: 'Inline',
						commentId: COMMENT_ID,
						threadId: THREAD_ID,
					},
				],
				expectedHeadSha: 'expected-head',
				outcome: 'comment',
				pendingCommentCount: 1,
				pendingReviewId: REVIEW_ID,
			})
		).rejects.toMatchObject({
			reason: 'unanchorable_comment',
			message: GITHUB_WRITE_REJECTED_MESSAGES.unanchorable_comment,
		})
		expect(repository.failReviewSubmission).toHaveBeenCalledWith({
			lastErrorCode: 'unanchorable_comment',
			submissionId: SUBMISSION.id,
		})
		expect(repository.echoBatchedReview).not.toHaveBeenCalled()
	})

	test.each([
		['edit', { title: 'Updated', body: 'Body' }],
		['retarget', { targetBranch: 'release' }],
		['close', { state: 'closed' }],
		['reopen', { state: 'open' }],
	] as const)('forwards and echoes a pull request %s', async (_action, update) => {
		const clientSpy = vi
			.spyOn(client, 'updatePullRequest')
			.mockResolvedValue(PULL_REQUEST)
		const echoSpy = vi.spyOn(repository, 'echoPullRequest').mockResolvedValue()

		await service.updatePullRequest(CONTEXT, update)

		expect(clientSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			body: 'body' in update ? update.body : undefined,
			state: 'state' in update ? update.state : undefined,
			targetBranch: 'targetBranch' in update ? update.targetBranch : undefined,
			title: 'title' in update ? update.title : undefined,
		})
		expect(echoSpy).toHaveBeenCalledWith({
			pullRequest: PULL_REQUEST,
			pullRequestId: PULL_REQUEST_ID,
			repositoryId: REPOSITORY_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, clientSpy, echoSpy)).toBe(true)
	})

	test('merges with the expected head and echoes the merge response sha', async () => {
		const mergeSpy = vi
			.spyOn(client, 'mergePullRequest')
			.mockResolvedValue('merge-response-sha')
		vi.spyOn(client, 'getPullRequest').mockResolvedValue(PULL_REQUEST)
		const echoSpy = vi.spyOn(repository, 'echoPullRequest').mockResolvedValue()

		await service.mergePullRequest(CONTEXT, {
			expectedHeadSha: 'expected-head',
			strategy: 'squash',
		})

		expect(mergeSpy).toHaveBeenCalledWith({
			...CLIENT_TARGET,
			expectedHeadSha: 'expected-head',
			strategy: 'squash',
		})
		expect(client.getPullRequest).toHaveBeenCalledWith(CLIENT_TARGET)
		expect(echoSpy).toHaveBeenCalledWith({
			mergeCommitSha: 'merge-response-sha',
			pullRequest: PULL_REQUEST,
			pullRequestId: PULL_REQUEST_ID,
			repositoryId: REPOSITORY_ID,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(hasWriteOrder(accountSpy, targetSpy, mergeSpy, echoSpy)).toBe(true)
	})

	test.each([
		['missing account', undefined],
		[
			'missing token',
			{ accessToken: null, scope: 'repo', accessTokenExpiresAt: null },
		],
		[
			'missing repo scope',
			{
				accessToken: 'user-token',
				scope: 'read:user user:email',
				accessTokenExpiresAt: null,
			},
		],
		[
			'expired token',
			{
				accessToken: 'user-token',
				scope: 'repo',
				accessTokenExpiresAt: new Date('2000-01-01T00:00:00Z'),
			},
		],
	] as const)('requires reconnect for a %s', async (_name, account) => {
		accountSpy.mockResolvedValue(account)

		const promise = service.createThread(CONTEXT, { body: 'Comment' })

		await expect(promise).rejects.toBeInstanceOf(GitHubReconnectRequiredError)
		await expect(promise).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
			message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
		})
		expect(targetSpy).not.toHaveBeenCalled()
		expect(client.createIssueComment).not.toHaveBeenCalled()
	})

	test('rejects a pull request without a GitHub mapping', async () => {
		targetSpy.mockResolvedValue(undefined)

		const promise = service.createThread(CONTEXT, { body: 'Comment' })

		await expect(promise).rejects.toBeInstanceOf(GitHubWriteRejectedError)
		await expect(promise).rejects.toMatchObject({
			reason: 'missing_mapping',
			message: GITHUB_WRITE_REJECTED_MESSAGES.missing_mapping,
		})
		expect(client.createIssueComment).not.toHaveBeenCalled()
	})

	test.each([
		[
			'top-level reply',
			() =>
				service.replyThread(CONTEXT, {
					body: 'Reply',
					threadId: THREAD_ID,
					threadKind: 'top_level',
				}),
			'top_level_reply_unsupported',
		],
		[
			'top-level resolution',
			() =>
				service.setThreadResolution(CONTEXT, {
					resolved: true,
					threadId: THREAD_ID,
					threadKind: 'top_level',
				}),
			'thread_not_resolvable',
		],
		[
			'fast-forward merge',
			() =>
				service.mergePullRequest(CONTEXT, {
					expectedHeadSha: 'head-sha',
					strategy: 'fast_forward',
				}),
			'fast_forward_unsupported',
		],
	] as const)('rejects %s before calling GitHub', async (_name, act, reason) => {
		await expect(act()).rejects.toMatchObject({
			reason,
			message: GITHUB_WRITE_REJECTED_MESSAGES[reason],
		})
		expect(clientCallCount(client)).toBe(0)
	})

	test('rejects a reviewer without a GitHub identity', async () => {
		vi.spyOn(repository, 'findUserIdentity').mockResolvedValue(undefined)

		await expect(
			service.requestReviewer(CONTEXT, { reviewerUserId: REVIEWER_USER_ID })
		).rejects.toMatchObject({
			reason: 'reviewer_not_on_github',
			message: GITHUB_WRITE_REJECTED_MESSAGES.reviewer_not_on_github,
		})
		expect(client.requestReviewer).not.toHaveBeenCalled()
	})

	test('rejects a bodyless request-changes review before GitHub', async () => {
		await expect(
			service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'head-sha',
				outcome: 'request_changes',
				pendingCommentCount: 0,
			})
		).rejects.toMatchObject({
			reason: 'review_body_required',
			message: GITHUB_WRITE_REJECTED_MESSAGES.review_body_required,
		})
		expect(client.createReview).not.toHaveBeenCalled()
	})

	test('lets a bodyless request-changes review through once it carries comments', async () => {
		const clientSpy = vi.spyOn(client, 'createReview').mockResolvedValue(REVIEW)

		vi.spyOn(repository, 'echoBatchedReview').mockResolvedValue(REVIEW_ID)

		expect(
			await service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'head-sha',
				outcome: 'request_changes',
				pendingCommentCount: 2,
			})
		).toBe(REVIEW_ID)
		expect(clientSpy).toHaveBeenCalledOnce()
	})

	test('lets a blank recorded scope reach GitHub and keeps a credential refusal classified', async () => {
		accountSpy.mockResolvedValue({
			accessToken: 'user-token',
			scope: '',
			accessTokenExpiresAt: null,
		})
		vi.spyOn(client, 'createIssueComment').mockRejectedValue(
			new GitHubReconnectRequiredError({ reason: 'credential' })
		)

		await expect(
			service.createThread(CONTEXT, { body: 'Comment' })
		).rejects.toBeInstanceOf(GitHubReconnectRequiredError)
		expect(client.createIssueComment).toHaveBeenCalledOnce()
		expect(repository.requestSync).not.toHaveBeenCalled()
	})

	test('keeps a provider review rejection classified without requesting sync', async () => {
		vi.spyOn(client, 'createReview').mockRejectedValue(
			new GitHubWriteRejectedError('self_approval')
		)

		await expect(
			service.submitReview(CONTEXT, {
				body: '',
				drafts: [],
				expectedHeadSha: 'head-sha',
				outcome: 'approve',
				pendingCommentCount: 0,
			})
		).rejects.toMatchObject({
			reason: 'self_approval',
			message: GITHUB_WRITE_REJECTED_MESSAGES.self_approval,
		})
		expect(repository.requestSync).not.toHaveBeenCalled()
		expect(repository.echoBatchedReview).not.toHaveBeenCalled()
	})

	test.each([
		[
			'issue comment',
			() =>
				vi
					.spyOn(client, 'createIssueComment')
					.mockRejectedValue(
						new GitHubResponseUnreadableError({ action: 'comment' })
					),
			() => service.createThread(CONTEXT, { body: 'Comment' }),
		],
		[
			'review',
			() =>
				vi
					.spyOn(client, 'createReview')
					.mockRejectedValue(
						new GitHubResponseUnreadableError({ action: 'review' })
					),
			() =>
				service.submitReview(CONTEXT, {
					body: '',
					drafts: [],
					expectedHeadSha: 'head-sha',
					outcome: 'approve',
					pendingCommentCount: 0,
				}),
		],
	] as const)('requests sync when an accepted %s response cannot be read', async (_name, arrange, act) => {
		arrange()
		vi.spyOn(repository, 'requestSync').mockResolvedValue(2)

		await expect(act()).rejects.toMatchObject({
			constructor: GitHubSyncDelayedError,
			code: 'CONFLICT',
			message: GITHUB_SYNC_DELAYED_MESSAGE,
		})
		expect(repository.requestSync).toHaveBeenCalledWith({
			repositoryId: REPOSITORY_ID,
		})
	})

	test('logs an echo failure, requests sync, and reports a delayed echo', async () => {
		vi.spyOn(client, 'createIssueComment').mockResolvedValue(ISSUE_COMMENT)
		vi.spyOn(repository, 'echoIssueComment').mockRejectedValue(
			new Error('database unavailable')
		)
		const requestSyncSpy = vi
			.spyOn(repository, 'requestSync')
			.mockResolvedValue(2)
		const logSpy = vi
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined)

		await expect(
			service.createThread(CONTEXT, { body: 'Comment' })
		).rejects.toMatchObject({
			constructor: GitHubSyncDelayedError,
			code: 'CONFLICT',
			message: GITHUB_SYNC_DELAYED_MESSAGE,
		})
		expect(logSpy).toHaveBeenCalledWith(
			expect.stringContaining(PULL_REQUEST_ID)
		)
		expect(requestSyncSpy).toHaveBeenCalledWith({
			repositoryId: REPOSITORY_ID,
		})
	})

	test('reports delayed sync when the follow-up pull request read fails after merge', async () => {
		vi.spyOn(client, 'mergePullRequest').mockResolvedValue('merge-response-sha')
		vi.spyOn(client, 'getPullRequest').mockRejectedValue(
			new GitHubUnavailableError({ action: 'pull_request', status: 500 })
		)
		vi.spyOn(repository, 'requestSync').mockResolvedValue(2)

		await expect(
			service.mergePullRequest(CONTEXT, {
				expectedHeadSha: 'expected-head',
				strategy: 'squash',
			})
		).rejects.toMatchObject({
			constructor: GitHubSyncDelayedError,
			code: 'CONFLICT',
			message: GITHUB_SYNC_DELAYED_MESSAGE,
		})
		expect(repository.requestSync).toHaveBeenCalledWith({
			repositoryId: REPOSITORY_ID,
		})
		expect(repository.echoPullRequest).not.toHaveBeenCalled()
	})
})

function clientCallCount(client: GitHubUserWriteClient): number {
	return [
		client.createIssueComment,
		client.createReviewComment,
		client.createReplyForReviewComment,
		client.updateIssueComment,
		client.updateReviewComment,
		client.deleteIssueComment,
		client.deleteReviewComment,
		client.resolveReviewThread,
		client.unresolveReviewThread,
		client.requestReviewer,
		client.removeRequestedReviewer,
		client.createReview,
		client.updatePullRequest,
		client.mergePullRequest,
		client.getPullRequest,
	].reduce((calls, method) => calls + vi.mocked(method).mock.calls.length, 0)
}

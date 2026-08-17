import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import type { GitHubGroupedReviewThread } from '@modules/github-sync/helpers/github-pull-request-conversation'
import type {
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncIssueComment,
	GitHubSyncPullRequest,
	GitHubSyncReview,
	GitHubSyncReviewComment,
} from '@modules/github-sync/infrastructure/github-sync.client.types'
import {
	type GitHubConversationAnchor,
	GitHubSyncConversationsRepository,
} from '@modules/github-sync/infrastructure/github-sync-conversations.repository'
import { GitHubUserWriteClient } from '@modules/github-write-through/infrastructure/github-user-write.client'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import {
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
} from '@repo/contracts'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	gitHubActors,
	gitHubInstallations,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	gitHubPullRequestReviewerRequestMappings,
	gitHubPullRequestReviewMappings,
	gitHubPullRequestThreadMappings,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	repositories,
	repositoryCollaborators,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type {
	PullRequestCommentId,
	PullRequestId,
	PullRequestThreadId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MERGE_SHA = 'c'.repeat(40)
const CREATED_AT = new Date('2026-08-16T10:00:00Z')
const UPDATED_AT = new Date('2026-08-16T11:00:00Z')
const PULL_REQUEST_URL = 'https://github.com/tessera-org/notes/pull/1'
const SYNC_LEASE_OWNER = 'github-write-through-integration'
let integrationAdapter: HonoAdapter

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ThreadBody {
	id: PullRequestThreadId
	kind: 'inline' | 'top_level'
	comments: { id: PullRequestCommentId; body: string }[]
}

interface ErrorBody {
	code: string
	message: string
}

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		RPCModule,
		AuthModule,
		RepositoriesModule,
		PullRequestsModule,
	],
	providers: [
		GitHubSyncConversationsRepository,
		{ provide: APP_FILTER, useClass: GlobalExceptionFilter },
	],
})
class GitHubWriteThroughIntegrationTestModule {}

describe('GitHub write-through integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let projectionRepository: GitHubSyncConversationsRepository
	let owner: IntegrationUser
	let reviewer: IntegrationUser
	let repositoryId: RepositoryId
	let pullRequestId: PullRequestId
	let actor: GitHubSyncActor
	let issueComment: GitHubSyncIssueComment
	let rootComment: GitHubSyncReviewComment
	let replyComment: GitHubSyncReviewComment
	let submittedReview: GitHubSyncReview & { outcome: 'approve' }
	let pullRequest: GitHubSyncPullRequest
	const createIssueComment = vi.fn()
	const createReviewComment = vi.fn()
	const createReplyForReviewComment = vi.fn()
	const updateIssueComment = vi.fn()
	const updateReviewComment = vi.fn()
	const deleteIssueComment = vi.fn()
	const deleteReviewComment = vi.fn()
	const resolveReviewThread = vi.fn()
	const unresolveReviewThread = vi.fn()
	const requestReviewer = vi.fn()
	const removeRequestedReviewer = vi.fn()
	const createReview = vi.fn()
	const updatePullRequest = vi.fn()
	const mergePullRequest = vi.fn()
	const getPullRequest = vi.fn()

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
		moduleRef = await Test.createTestingModule({
			imports: [GitHubWriteThroughIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				listRepositoryRefs: vi.fn().mockResolvedValue({
					branches: [
						{
							type: 'branch',
							name: 'main',
							qualifiedName: 'refs/heads/main',
							target: BASE_SHA,
						},
						{
							type: 'branch',
							name: 'feature',
							qualifiedName: 'refs/heads/feature',
							target: HEAD_SHA,
						},
					],
					tags: [],
				}),
				compareRepositoryRefs: vi.fn().mockResolvedValue({
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					mergeBaseSha: BASE_SHA,
					commits: [],
					files: [],
					isTruncated: false,
					commitsTruncated: false,
					commitLimit: 500,
					fileLimit: 300,
				}),
			})
			.overrideProvider(GitHubUserWriteClient)
			.useValue({
				createIssueComment,
				createReviewComment,
				createReplyForReviewComment,
				updateIssueComment,
				updateReviewComment,
				deleteIssueComment,
				deleteReviewComment,
				resolveReviewThread,
				unresolveReviewThread,
				requestReviewer,
				removeRequestedReviewer,
				createReview,
				updatePullRequest,
				mergePullRequest,
				getPullRequest,
			})
			.compile()

		adapter = new HonoAdapter()
		integrationAdapter = adapter
		app = moduleRef.createNestApplication(adapter)
		projectionRepository = moduleRef.get(GitHubSyncConversationsRepository)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		vi.clearAllMocks()
		owner = await createIntegrationUser('owner')
		reviewer = await createIntegrationUser('reviewer')
		actor = {
			nodeId: 'actor-owner',
			numericId: 500n,
			login: owner.username,
			type: 'user',
		}
		issueComment = {
			nodeId: 'issue-comment-node',
			numericId: 101n,
			author: actor,
			body: 'Top level',
			htmlUrl: `${PULL_REQUEST_URL}#issuecomment-101`,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		}
		rootComment = {
			nodeId: 'root-comment-node',
			numericId: 201n,
			author: actor,
			body: 'Inline',
			htmlUrl: `${PULL_REQUEST_URL}#discussion_r201`,
			reviewNumericId: 301n,
			subjectType: 'line',
			path: 'src/confirmed.ts',
			side: 'left',
			line: 11,
			commitId: HEAD_SHA,
			createdAt: CREATED_AT,
			updatedAt: CREATED_AT,
		}
		replyComment = {
			...rootComment,
			nodeId: 'reply-comment-node',
			numericId: 202n,
			body: 'Reply',
			htmlUrl: `${PULL_REQUEST_URL}#discussion_r202`,
			reviewNumericId: undefined,
			inReplyToNumericId: 201n,
			createdAt: UPDATED_AT,
			updatedAt: UPDATED_AT,
		}
		submittedReview = {
			nodeId: 'review-node',
			numericId: 301n,
			reviewer: {
				nodeId: 'actor-reviewer',
				numericId: 501n,
				login: reviewer.username,
				type: 'user',
			},
			body: '',
			outcome: 'approve',
			dismissed: false,
			htmlUrl: `${PULL_REQUEST_URL}#pullrequestreview-301`,
			commitId: HEAD_SHA,
			submittedAt: UPDATED_AT,
		}
		pullRequest = pullRequestSnapshot('open')
		createIssueComment.mockImplementation(({ body }: { body: string }) =>
			Promise.resolve({ ...issueComment, body })
		)
		createReviewComment.mockImplementation(({ body }: { body: string }) =>
			Promise.resolve({ ...rootComment, body })
		)
		createReplyForReviewComment.mockImplementation(
			({ body }: { body: string }) => Promise.resolve({ ...replyComment, body })
		)
		updateIssueComment.mockImplementation(({ body }: { body: string }) =>
			Promise.resolve({ ...issueComment, body, updatedAt: UPDATED_AT })
		)
		updateReviewComment.mockImplementation(
			({
				body,
				commentNumericId,
			}: {
				body: string
				commentNumericId: bigint
			}) =>
				Promise.resolve({
					...(commentNumericId === 201n ? rootComment : replyComment),
					body,
					updatedAt: UPDATED_AT,
				})
		)
		deleteIssueComment.mockResolvedValue(undefined)
		deleteReviewComment.mockResolvedValue(undefined)
		resolveReviewThread.mockResolvedValue(undefined)
		unresolveReviewThread.mockResolvedValue(undefined)
		requestReviewer.mockResolvedValue(undefined)
		removeRequestedReviewer.mockResolvedValue(undefined)
		createReview.mockResolvedValue(submittedReview)
		updatePullRequest.mockImplementation(() => Promise.resolve(pullRequest))
		mergePullRequest.mockResolvedValue(MERGE_SHA)
		getPullRequest.mockImplementation(() => Promise.resolve(pullRequest))
		const seeded = await seedMirroredPullRequest(owner)
		repositoryId = seeded.repositoryId
		pullRequestId = seeded.pullRequestId
		await db.insert(repositoryCollaborators).values({
			repositoryId,
			userId: reviewer.id,
			role: 'write',
		})
		await db.insert(gitHubActors).values({
			externalNodeId: 'actor-reviewer',
			externalNumericId: 501n,
			login: reviewer.username,
			type: 'user',
			userId: reviewer.id,
		})
		await linkGitHubAccount(reviewer, '501')
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('echoes GitHub collaboration writes and projection adopts the same nodes', async () => {
		const topLevelResponse = await createThread({ body: 'Top level' })
		expect(topLevelResponse.status).toBe(200)
		const topLevel = (await topLevelResponse.json()) as ThreadBody
		expect(topLevel).toMatchObject({ kind: 'top_level' })
		expect(await db.query.pullRequestThreads.findMany()).toEqual([
			expect.objectContaining({ provider: 'github', kind: 'top_level' }),
		])
		expect(await db.query.pullRequestComments.findMany()).toEqual([
			expect.objectContaining({ provider: 'github', body: 'Top level' }),
		])
		expect(await db.query.gitHubPullRequestCommentMappings.findMany()).toEqual([
			expect.objectContaining({
				externalNodeId: issueComment.nodeId,
				externalNumericId: issueComment.numericId,
				kind: 'issue',
			}),
		])
		expect(await db.query.repositoryExternalSources.findFirst()).toMatchObject({
			requestedSyncVersion: 1,
			syncStatus: 'pending',
		})

		const inlineResponse = await createThread({
			body: 'Inline',
			anchor: {
				path: 'src/requested.ts',
				side: 'right',
				line: 9,
				anchorSha: HEAD_SHA,
				baseSha: BASE_SHA,
				headSha: HEAD_SHA,
				lineExcerpt: 'const value = 1',
			},
		})
		expect(inlineResponse.status).toBe(200)
		const inline = (await inlineResponse.json()) as ThreadBody
		expect(
			await db.query.pullRequestThreads.findFirst({
				where: (threads, { eq }) => eq(threads.id, inline.id),
			})
		).toMatchObject({
			provider: 'github',
			kind: 'inline',
			path: 'src/confirmed.ts',
			side: 'left',
			line: 11,
			anchorSha: HEAD_SHA,
		})

		const replyResponse = await threadAction(inline.id, 'comments', {
			body: 'Reply',
		})
		expect(replyResponse.status).toBe(200)
		const replied = (await replyResponse.json()) as ThreadBody
		expect(replied.comments).toHaveLength(2)
		expect(createReplyForReviewComment).toHaveBeenCalledWith(
			expect.objectContaining({ rootCommentNumericId: 201n })
		)

		const reviewResponse = await request(
			`${pullRequestUrl()}/reviews`,
			'POST',
			{
				outcome: 'approve',
				expectedHeadSha: HEAD_SHA,
			},
			reviewer.headers
		)
		expect(reviewResponse.status).toBe(200)
		expect(await db.query.pullRequestReviews.findMany()).toEqual([
			expect.objectContaining({
				provider: 'github',
				reviewerUserId: reviewer.id,
				outcome: 'approve',
				headSha: HEAD_SHA,
			}),
		])
		expect(await db.query.gitHubPullRequestReviewMappings.findMany()).toEqual([
			expect.objectContaining({ externalNodeId: submittedReview.nodeId }),
		])
		expect(
			(await db.query.pullRequestEvents.findMany()).filter(
				event => event.type === 'review_submitted'
			)
		).toHaveLength(1)

		const countsBeforeProjection = await conversationCounts()
		await projectConversation(fullConversation())
		expect(await conversationCounts()).toEqual(countsBeforeProjection)
		const inlineMapping =
			await db.query.gitHubPullRequestThreadMappings.findFirst({
				where: (mappings, { eq }) =>
					eq(mappings.rootCommentNodeId, rootComment.nodeId),
			})
		expect(inlineMapping).toMatchObject({ externalNodeId: 'thread-node' })
		if (!inlineMapping) throw new Error('Inline mapping missing')

		expect((await threadAction(inline.id, 'resolve')).status).toBe(200)
		expect(resolveReviewThread).toHaveBeenCalledWith(
			expect.objectContaining({ threadNodeId: 'thread-node' })
		)
		expect((await threadAction(inline.id, 'unresolve')).status).toBe(200)

		await projectConversation(
			{
				...fullConversation(),
				reviewComments: [{ ...rootComment, body: 'stale body' }, replyComment],
				reviews: [{ ...submittedReview, body: 'stale review body' }],
				reviewThreads: [
					{ ...reviewThread(), resolved: true, resolvedBy: actor },
				],
			},
			0
		)
		expect(
			await db.query.pullRequestComments.findFirst({
				where: (comments, { eq }) => eq(comments.body, 'Inline'),
			})
		).toBeDefined()
		expect(await db.query.pullRequestReviews.findFirst()).toMatchObject({
			body: '',
		})
		expect(
			await db.query.pullRequestThreads.findFirst({
				where: (threads, { eq }) => eq(threads.id, inline.id),
			})
		).toMatchObject({ resolvedAt: null })

		const replyId = replied.comments[1]?.id
		const rootId = replied.comments[0]?.id
		if (!(replyId && rootId)) throw new Error('Inline comments missing')
		expect(
			(await commentAction(replyId, 'PATCH', { body: 'Edited reply' })).status
		).toBe(200)
		expect(
			await db.query.pullRequestComments.findFirst({
				where: (comments, { eq }) => eq(comments.id, replyId),
			})
		).toMatchObject({ body: 'Edited reply', provider: 'github' })
		expect((await commentAction(replyId, 'DELETE')).status).toBe(200)
		expect((await commentAction(rootId, 'DELETE')).status).toBe(200)
		expect(
			await db.query.pullRequestThreads.findFirst({
				where: (threads, { eq }) => eq(threads.id, inline.id),
			})
		).toBeUndefined()
		expect(
			await db.query.gitHubPullRequestThreadMappings.findFirst({
				where: (mappings, { eq }) => eq(mappings.id, inlineMapping.id),
			})
		).toMatchObject({ pullRequestThreadId: null, deletedAt: expect.any(Date) })

		pullRequest = pullRequestSnapshot('merged')
		const mergeResponse = await request(`${pullRequestUrl()}/merge`, 'POST', {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			strategy: 'squash',
		})
		expect(mergeResponse.status).toBe(200)
		expect(await mergeResponse.json()).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: MERGE_SHA },
		})
		expect(
			await db.query.pullRequests.findFirst({
				where: (rows, { eq }) => eq(rows.id, pullRequestId),
			})
		).toMatchObject({ state: 'merged', mergeCommitSha: MERGE_SHA })
		expect(await mergedEventCount()).toBe(1)
		await projectConversation({
			issueComments: [issueComment],
			reviewComments: [],
			reviews: [submittedReview],
			requestedReviewers: [],
			reviewThreads: [],
		})
		expect(await mergedEventCount()).toBe(1)
	})

	test('returns settled HTTP rejections for reconnect, native guard, shape, and strategy failures', async () => {
		await db.delete(account)
		const unlinked = await createThread({ body: 'Comment' })
		expect(unlinked.status).toBe(401)
		expect((await unlinked.json()) as ErrorBody).toMatchObject({
			code: 'UNAUTHORIZED',
			message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
		})
		await linkGitHubAccount(owner)

		const selfApproval = await request(`${pullRequestUrl()}/reviews`, 'POST', {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(selfApproval.status).toBe(403)
		expect((await selfApproval.json()) as ErrorBody).toMatchObject({
			code: 'FORBIDDEN',
			message: 'The pull request author cannot review their own pull request.',
		})
		expect(createReview).not.toHaveBeenCalled()

		const topLevel = (await (
			await createThread({ body: 'Top level' })
		).json()) as ThreadBody
		const topLevelReply = await threadAction(topLevel.id, 'comments', {
			body: 'Reply',
		})
		expect(topLevelReply.status).toBe(409)
		expect((await topLevelReply.json()) as ErrorBody).toMatchObject({
			code: 'CONFLICT',
			message: GITHUB_WRITE_REJECTED_MESSAGES.top_level_reply_unsupported,
		})

		const fastForward = await request(`${pullRequestUrl()}/merge`, 'POST', {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			strategy: 'fast_forward',
		})
		expect(fastForward.status).toBe(409)
		expect((await fastForward.json()) as ErrorBody).toMatchObject({
			code: 'CONFLICT',
			message: GITHUB_WRITE_REJECTED_MESSAGES.fast_forward_unsupported,
		})
	})

	test('forwards mirrored reviewer and pull request lifecycle routes to GitHub', async () => {
		const requested = await request(`${pullRequestUrl()}/reviewers`, 'POST', {
			reviewerUsername: reviewer.username,
		})
		expect(requested.status).toBe(200)
		expect(await requested.json()).toMatchObject({
			targetKind: 'user',
			reviewer: { username: reviewer.username, provider: 'tessera' },
			requestedBy: { username: owner.username, provider: 'tessera' },
		})
		expect(requestReviewer).toHaveBeenCalledWith(
			expect.objectContaining({ reviewerLogin: reviewer.username })
		)
		expect(await db.query.pullRequestReviewerRequests.findMany()).toEqual([
			expect.objectContaining({
				provider: 'github',
				reviewerUserId: reviewer.id,
				removedAt: null,
			}),
		])
		expect(
			await db.query.gitHubPullRequestReviewerRequestMappings.findMany()
		).toEqual([
			expect.objectContaining({
				targetNodeId: 'actor-reviewer',
				active: true,
			}),
		])

		const removed = await request(
			`${pullRequestUrl()}/reviewers/${reviewer.username}`,
			'DELETE'
		)
		expect(removed.status).toBe(200)
		expect(await removed.json()).toEqual({ removed: true })
		expect(removeRequestedReviewer).toHaveBeenCalledWith(
			expect.objectContaining({ reviewerLogin: reviewer.username })
		)
		expect(
			await db.query.pullRequestReviewerRequests.findFirst()
		).toMatchObject({
			removedAt: expect.any(Date),
		})
		expect(
			await db.query.gitHubPullRequestReviewerRequestMappings.findFirst()
		).toMatchObject({ active: false })

		pullRequest = {
			...pullRequestSnapshot('open'),
			title: 'Edited on GitHub',
			body: 'Updated body',
		}
		const edited = await request(pullRequestUrl(), 'PATCH', {
			title: pullRequest.title,
			body: pullRequest.body,
		})
		expect(edited.status).toBe(200)
		expect(await edited.json()).toMatchObject({
			title: pullRequest.title,
			body: pullRequest.body,
		})

		pullRequest = { ...pullRequest, targetBranch: 'release' }
		const retargeted = await request(`${pullRequestUrl()}/retarget`, 'POST', {
			targetBranch: 'release',
		})
		expect(retargeted.status).toBe(200)
		expect(await retargeted.json()).toMatchObject({ targetBranch: 'release' })

		pullRequest = { ...pullRequest, state: 'closed', closedAt: UPDATED_AT }
		const closed = await request(`${pullRequestUrl()}/close`, 'POST')
		expect(closed.status).toBe(200)
		expect(await closed.json()).toMatchObject({ state: 'closed' })

		pullRequest = { ...pullRequest, state: 'open', closedAt: undefined }
		const reopened = await request(`${pullRequestUrl()}/reopen`, 'POST')
		expect(reopened.status).toBe(200)
		expect(await reopened.json()).toMatchObject({ state: 'open' })
		expect(updatePullRequest).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				title: 'Edited on GitHub',
				body: 'Updated body',
			})
		)
		expect(updatePullRequest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ targetBranch: 'release' })
		)
		expect(updatePullRequest).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ state: 'closed' })
		)
		expect(updatePullRequest).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({ state: 'open' })
		)
		expect(
			await db.query.pullRequests.findFirst({
				where: (rows, { eq }) => eq(rows.id, pullRequestId),
			})
		).toMatchObject({
			state: 'open',
			closedAt: null,
			targetBranch: 'release',
			title: 'Edited on GitHub',
			body: 'Updated body',
		})
	})

	test('keeps native repositories on the native comment path', async () => {
		await resetIntegrationDatabase()
		vi.clearAllMocks()
		owner = await createIntegrationUser('owner')
		await seedNativePullRequest(owner)

		const response = await createThread({ body: 'Native comment' })

		expect(response.status).toBe(200)
		expect(await db.query.pullRequestComments.findMany()).toEqual([
			expect.objectContaining({ provider: 'tessera', body: 'Native comment' }),
		])
		expect(userWriteCallCount()).toBe(0)
	})

	function pullRequestSnapshot(
		state: 'closed' | 'merged' | 'open'
	): GitHubSyncPullRequest {
		return {
			nodeId: 'pull-request-node',
			numericId: 900n,
			number: 1,
			htmlUrl: PULL_REQUEST_URL,
			title: 'Feature',
			body: '',
			state,
			draft: false,
			author: actor,
			mergedBy: state === 'merged' ? actor : undefined,
			mergeCommitSha: state === 'merged' ? 'provider-get-sha' : undefined,
			sourceBranch: 'feature',
			targetBranch: 'main',
			headRepositoryNodeId: 'repository-node',
			baseRepositoryNodeId: 'repository-node',
			headSha: HEAD_SHA,
			baseSha: BASE_SHA,
			createdAt: CREATED_AT,
			updatedAt: UPDATED_AT,
			closedAt: state === 'open' ? undefined : UPDATED_AT,
			mergedAt: state === 'merged' ? UPDATED_AT : undefined,
		}
	}

	function fullConversation(): GitHubPullRequestConversation {
		return {
			issueComments: [issueComment],
			reviewComments: [rootComment, replyComment],
			reviews: [submittedReview],
			requestedReviewers: [],
			reviewThreads: [reviewThread()],
		}
	}

	function reviewThread() {
		return {
			nodeId: 'thread-node',
			resolved: false,
			outdated: false,
			subjectType: 'line' as const,
			path: rootComment.path,
			line: rootComment.line,
			side: rootComment.side,
			comments: [
				{ nodeId: rootComment.nodeId, originalCommitSha: HEAD_SHA },
				{
					nodeId: replyComment.nodeId,
					replyToNodeId: rootComment.nodeId,
					originalCommitSha: HEAD_SHA,
				},
			],
		}
	}

	async function projectConversation(
		conversation: GitHubPullRequestConversation,
		syncVersion?: number
	) {
		const mapping = await pullRequestMapping()
		const actors = await db.query.gitHubActors.findMany()
		const anchor: GitHubConversationAnchor = {
			path: rootComment.path,
			side: rootComment.side ?? 'right',
			line: rootComment.line ?? 1,
			anchorSha: rootComment.commitId ?? HEAD_SHA,
			baseSha: BASE_SHA,
			headSha: HEAD_SHA,
			lineExcerpt: 'const value = 1',
		}
		const thread: GitHubGroupedReviewThread = {
			externalNodeId: 'thread-node',
			rootCommentNodeId: rootComment.nodeId,
			subjectType: 'line',
			resolved: conversation.reviewThreads[0]?.resolved ?? false,
			resolvedBy: conversation.reviewThreads[0]?.resolvedBy,
			root: conversation.reviewComments[0] ?? rootComment,
			comments: conversation.reviewComments,
		}
		const source = await db.query.repositoryExternalSources.findFirst()

		await projectionRepository.projectPullRequestConversation({
			actorIds: new Map(
				actors.map(actorRow => [actorRow.externalNodeId, actorRow.id])
			),
			authorityGeneration: source?.authorityGeneration ?? 1,
			conversation,
			deliveries: [],
			leaseOwner: SYNC_LEASE_OWNER,
			orphanedComments: [],
			repositoryId,
			syncedAt: new Date(),
			syncVersion: syncVersion ?? source?.requestedSyncVersion ?? 0,
			target: {
				pullRequestMappingId: mapping.id,
				pullRequestId,
				externalNodeId: mapping.externalNodeId,
				externalNumber: mapping.externalNumber,
				baseSha: mapping.baseSha,
				headSha: mapping.headSha,
			},
			threads:
				conversation.reviewComments.length > 0
					? [{ anchor, providerOutdated: false, thread }]
					: [],
		})
	}

	function pullRequestMapping() {
		return db.query.gitHubPullRequestMappings.findFirst().then(mapping => {
			if (!mapping) throw new Error('GitHub pull request mapping missing')

			return mapping
		})
	}

	async function conversationCounts() {
		const [
			threads,
			comments,
			reviews,
			threadMappings,
			commentMappings,
			reviewMappings,
		] = await Promise.all([
			db.query.pullRequestThreads.findMany(),
			db.query.pullRequestComments.findMany(),
			db.query.pullRequestReviews.findMany(),
			db.query.gitHubPullRequestThreadMappings.findMany(),
			db.query.gitHubPullRequestCommentMappings.findMany(),
			db.query.gitHubPullRequestReviewMappings.findMany(),
		])

		return {
			threads: threads.length,
			comments: comments.length,
			reviews: reviews.length,
			threadMappings: threadMappings.length,
			commentMappings: commentMappings.length,
			reviewMappings: reviewMappings.length,
		}
	}

	async function mergedEventCount() {
		return (
			await db.query.pullRequestEvents.findMany({
				where: (events, { eq }) => eq(events.type, 'merged'),
			})
		).length
	}

	function createThread(body: object) {
		return request(`${pullRequestUrl()}/threads`, 'POST', body)
	}

	function threadAction(
		threadId: PullRequestThreadId,
		action: 'comments' | 'resolve' | 'unresolve',
		body?: object
	) {
		return request(
			`${pullRequestUrl()}/threads/${threadId}/${action}`,
			'POST',
			body
		)
	}

	function commentAction(
		commentId: PullRequestCommentId,
		method: 'DELETE' | 'PATCH',
		body?: object
	) {
		return request(`${pullRequestUrl()}/comments/${commentId}`, method, body)
	}

	function pullRequestUrl() {
		return 'http://localhost/repositories/owner/notes/pulls/1'
	}

	function request(
		url: string,
		method: 'DELETE' | 'PATCH' | 'POST',
		body?: object,
		headers = owner.headers
	) {
		const requestHeaders = new Headers(headers)
		if (body) requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(url, {
			method,
			headers: requestHeaders,
			body: body ? JSON.stringify(body) : undefined,
		})
	}

	function userWriteCallCount() {
		return [
			createIssueComment,
			createReviewComment,
			createReplyForReviewComment,
			updateIssueComment,
			updateReviewComment,
			deleteIssueComment,
			deleteReviewComment,
			resolveReviewThread,
			unresolveReviewThread,
			requestReviewer,
			removeRequestedReviewer,
			createReview,
			updatePullRequest,
			mergePullRequest,
			getPullRequest,
		].reduce((calls, method) => calls + method.mock.calls.length, 0)
	}
})

async function seedMirroredPullRequest(owner: IntegrationUser) {
	const native = await seedNativePullRequest(owner)
	const [installation] = await db
		.insert(gitHubInstallations)
		.values({
			externalInstallationId: 8888n,
			accountNodeId: 'organization-node',
			accountLogin: 'tessera-org',
			targetType: 'organization',
		})
		.returning({ id: gitHubInstallations.id })
	if (!installation) throw new Error('GitHub installation creation failed')
	const [authorActor] = await db
		.insert(gitHubActors)
		.values({
			externalNodeId: 'actor-owner',
			externalNumericId: 500n,
			login: owner.username,
			type: 'user',
			userId: owner.id,
		})
		.returning({ id: gitHubActors.id })
	if (!authorActor) throw new Error('GitHub actor creation failed')
	await db.insert(repositoryExternalSources).values({
		repositoryId: native.repositoryId,
		provider: 'github',
		installationId: installation.id,
		externalRepositoryNodeId: 'repository-node',
		externalRepositoryId: 4242n,
		ownerLogin: 'tessera-org',
		name: 'notes',
		fullName: 'tessera-org/notes',
		sourceUrl: 'https://github.com/tessera-org/notes',
		sourceDefaultBranch: 'main',
		mirrorMode: 'github_to_tessera',
		syncStatus: 'succeeded',
		syncLeaseOwner: SYNC_LEASE_OWNER,
		syncLeaseAcquiredAt: new Date(),
		syncLeaseExpiresAt: new Date(Date.now() + 60_000),
	})
	await linkGitHubAccount(owner)
	await db
		.update(pullRequests)
		.set({ provider: 'github' })
		.where(eq(pullRequests.id, native.pullRequestId))
	await db.insert(gitHubPullRequestMappings).values({
		repositoryId: native.repositoryId,
		pullRequestId: native.pullRequestId,
		externalNodeId: 'pull-request-node',
		externalNumericId: 900n,
		externalNumber: 1,
		htmlUrl: PULL_REQUEST_URL,
		authorActorId: authorActor.id,
		headRepositoryNodeId: 'repository-node',
		baseRepositoryNodeId: 'repository-node',
		headSha: HEAD_SHA,
		baseSha: BASE_SHA,
		providerCreatedAt: CREATED_AT,
		providerUpdatedAt: CREATED_AT,
		lastSyncedAt: CREATED_AT,
	})

	return native
}

async function seedNativePullRequest(owner: IntegrationUser) {
	const repositoryResponse = await integrationRequest(
		'http://localhost/repositories',
		'POST',
		owner.headers,
		{ name: 'Notes', slug: 'notes', visibility: 'public' }
	)
	if (repositoryResponse.status !== 200)
		throw new Error(`Repository creation failed: ${repositoryResponse.status}`)
	const pullRequestResponse = await integrationRequest(
		'http://localhost/repositories/owner/notes/pulls',
		'POST',
		owner.headers,
		{
			sourceBranch: 'feature',
			targetBranch: 'main',
			title: 'Feature',
		}
	)
	if (pullRequestResponse.status !== 200)
		throw new Error(
			`Pull request creation failed: ${pullRequestResponse.status}`
		)
	const repository = await db.query.repositories.findFirst()
	const pullRequest = await db.query.pullRequests.findFirst()
	if (!(repository && pullRequest)) throw new Error('Native fixture missing')

	return { repositoryId: repository.id, pullRequestId: pullRequest.id }
}

async function linkGitHubAccount(
	integrationUser: IntegrationUser,
	providerAccountId = '500'
) {
	await db.insert(account).values({
		accountId: providerAccountId,
		providerId: 'github',
		userId: integrationUser.id,
		accessToken: 'github-user-token',
		scope: 'read:user repo',
		accessTokenExpiresAt: null,
	})
}

function integrationRequest(
	url: string,
	method: 'POST',
	headers: Headers,
	body: object
) {
	const requestHeaders = new Headers(headers)
	requestHeaders.set('content-type', 'application/json')

	return integrationAdapter.hono.request(url, {
		method,
		headers: requestHeaders,
		body: JSON.stringify(body),
	})
}

async function createIntegrationUser(
	username: string
): Promise<IntegrationUser> {
	const token = crypto.randomUUID()
	const [createdUser] = await db
		.insert(user)
		.values({
			name: username,
			email: `${username}@example.com`,
			emailVerified: true,
			username,
		})
		.returning({ id: user.id })
	if (!createdUser) throw new Error('Integration user creation failed')
	await db.insert(session).values({
		token,
		userId: createdUser.id,
		expiresAt: new Date(Date.now() + 86_400_000),
	})
	const headers = new Headers()
	headers.set(
		'cookie',
		`better-auth.session_token=${token}.${await makeSignature(token, 'test-auth-secret')}`
	)

	return { id: createdUser.id, headers, username }
}

async function resetIntegrationDatabase() {
	await db.delete(gitHubPullRequestEventMappings)
	await db.delete(gitHubPullRequestCommentMappings)
	await db.delete(gitHubPullRequestReviewerRequestMappings)
	await db.delete(gitHubPullRequestReviewMappings)
	await db.delete(gitHubPullRequestThreadMappings)
	await db.delete(gitHubPullRequestMappings)
	await db.delete(pullRequestEvents)
	await db.delete(pullRequestReviewerRequests)
	await db.delete(pullRequestComments)
	await db.delete(pullRequestThreads)
	await db.delete(pullRequestReviews)
	await db.delete(pullRequests)
	await db.delete(repositoryPullRequestCounters)
	await db.delete(repositoryCollaborators)
	await db.delete(repositoryExternalSources)
	await db.delete(repositories)
	await db.delete(gitHubActors)
	await db.delete(gitHubInstallations)
	await db.delete(session)
	await db.delete(account)
	await db.delete(user)
}

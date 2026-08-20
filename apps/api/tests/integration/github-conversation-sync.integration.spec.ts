import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { ChecksModule } from '@modules/checks'
import { GitHubSyncProcessor } from '@modules/github-sync/application/github-sync.processor'
import { GitHubWebhookService } from '@modules/github-sync/application/github-webhook.service'
import { GitHubAppAuthService } from '@modules/github-sync/infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '@modules/github-sync/infrastructure/github-sync.client'
import type {
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncIssueComment,
	GitHubSyncPullRequest,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewThread,
} from '@modules/github-sync/infrastructure/github-sync.client.types'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_REPOSITORY_JOB,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '@modules/github-sync/infrastructure/github-sync.queue'
import {
	GitHubSyncRepository,
	type GitHubSyncRequest,
} from '@modules/github-sync/infrastructure/github-sync.repository'
import { GitHubSyncChecksRepository } from '@modules/github-sync/infrastructure/github-sync-checks.repository'
import { GitHubSyncConversationsRepository } from '@modules/github-sync/infrastructure/github-sync-conversations.repository'
import { GitHubWebhookController } from '@modules/github-sync/presentation/github-webhook.controller'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { GITHUB_RECONNECT_REQUIRED_MESSAGE } from '@repo/contracts'
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
	gitHubWebhookDeliveries,
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
import type { UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import type { Job } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const WEBHOOK_SECRET = 'test-github-webhook-secret'
const EXTERNAL_REPOSITORY_ID = 4242
const EXTERNAL_INSTALLATION_ID = 8888
const PULL_REQUEST_URL = 'https://github.com/tessera-org/notes/pull/1'
/** Numbered so the right side reads 5, 6, 7 — the anchored line is the last. */
const DIFF_HUNK =
	'@@ -1,3 +5,4 @@\n const value = 0\n+const value = 1\n+const value = 2'
const ROOT_CREATED_AT = new Date('2026-08-01T10:00:00Z')
const REPLY_CREATED_AT = new Date('2026-08-01T10:15:00Z')
const ISSUE_COMMENT_CREATED_AT = new Date('2026-08-01T10:30:00Z')
const REVIEW_SUBMITTED_AT = new Date('2026-08-01T10:05:00Z')
const EDITED_AT = new Date('2026-08-02T09:00:00Z')

const authorActor: GitHubSyncActor = {
	nodeId: 'actor-marta',
	numericId: 500n,
	login: 'marta',
	type: 'user',
}
const mappedActor: GitHubSyncActor = {
	nodeId: 'actor-maya',
	numericId: 501n,
	login: 'maya',
	type: 'user',
	avatarUrl: 'https://avatars.githubusercontent.com/u/501',
	htmlUrl: 'https://github.com/maya',
}
const unmappedActor: GitHubSyncActor = {
	nodeId: 'actor-octo',
	numericId: 502n,
	login: 'octo',
	type: 'user',
}
const otherUnmappedActor: GitHubSyncActor = {
	nodeId: 'actor-nova',
	numericId: 503n,
	login: 'nova',
	type: 'user',
}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ActorResponse {
	key: string
	provider: string
	userId?: string
	username: string
}

interface ThreadsResponseBody {
	threads: {
		id: string
		kind: 'inline' | 'top_level'
		outdated: boolean
		resolved?: { by: ActorResponse }
		comments: {
			body: string
			author: ActorResponse
			sourceUrl?: string
			editedAt?: string
		}[]
	}[]
	comparison: { baseSha: string; headSha: string }
	viewer: {
		canComment: boolean
		canResolveAnyThread: boolean
		canDeleteAnyComment: boolean
	}
}

interface PullRequestResponseBody {
	authority: string
	reviews: {
		state: string
		outcome: string
		body: string
		reviewer: ActorResponse
		dismissedAt?: string
		sourceUrl?: string
	}[]
	effectiveReviewStates: {
		outcome: string
		reviewer: ActorResponse
	}[]
	reviewerRequests: { targetKind: string; reviewer: ActorResponse }[]
	viewer: {
		allowedOutcomes: string[]
		canRequestReviewers: boolean
		canRemoveReviewerRequests: boolean
	}
}

describe('GitHub conversation sync integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let processor: GitHubSyncProcessor
	let enqueue: ReturnType<typeof vi.fn>
	let getPullRequestConversation: ReturnType<typeof vi.fn>
	let conversation: GitHubPullRequestConversation
	let reconciledPullRequests: GitHubSyncPullRequest[]
	let owner: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		enqueue = vi.fn().mockResolvedValue(undefined)
		getPullRequestConversation = vi.fn(() => Promise.resolve(conversation))
		moduleRef = await Test.createTestingModule({
			imports: [
				EnvModule,
				DatabaseModule,
				GitStorageModule,
				RPCModule,
				AuthModule,
				RepositoriesModule,
				PullRequestsModule,
				ChecksModule,
			],
			controllers: [GitHubWebhookController],
			providers: [
				GitHubWebhookService,
				GitHubSyncProcessor,
				GitHubSyncRepository,
				GitHubSyncChecksRepository,
				GitHubSyncConversationsRepository,
				{ provide: GitHubSyncQueue, useValue: { enqueue } },
				{
					provide: GitHubAppAuthService,
					useValue: {
						getInstallationToken: vi.fn().mockResolvedValue({
							token: 'installation-token',
							expiresAt: new Date('2026-08-01T12:00:00Z'),
						}),
					},
				},
				{
					provide: GitHubSyncClient,
					useValue: {
						getChecksForRef: vi.fn((({ ref }: { ref: string }) =>
							Promise.resolve({
								sha: ref,
								suites: [],
								runs: [],
								statuses: [],
							})) satisfies GitHubSyncClient['getChecksForRef']),
						getPullRequestConversation,
						getRepositoryReconciliation: vi.fn(() =>
							Promise.resolve({
								repository: {
									nodeId: 'repository-node',
									numericId: BigInt(EXTERNAL_REPOSITORY_ID),
									ownerLogin: 'tessera-org',
									name: 'notes',
									fullName: 'tessera-org/notes',
									htmlUrl: 'https://github.com/tessera-org/notes',
									cloneUrl: 'https://github.com/tessera-org/notes.git',
									defaultBranch: 'main',
								},
								pullRequests: reconciledPullRequests,
								pullRequestCursorAt: new Date('2026-08-01T11:00:00Z'),
							})
						),
					},
				},
				{ provide: APP_FILTER, useClass: GlobalExceptionFilter },
			],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				importRepository: vi.fn(({ storagePath }) =>
					Promise.resolve({ storagePath, defaultBranch: 'main' })
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
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter, { rawBody: true })
		processor = moduleRef.get(GitHubSyncProcessor)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		enqueue.mockClear()
		getPullRequestConversation.mockClear()
		conversation = fullConversation()
		reconciledPullRequests = [pullRequestSnapshot()]
		owner = await createIntegrationUser('maya')
		await db.insert(account).values({
			accountId: mappedActor.numericId.toString(),
			providerId: 'github',
			userId: owner.id,
			accessToken: 'github-token',
		})
		await createMirroredRepository()
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('projects comments, threads, reviews, and reviewer requests as native rows', async () => {
		await runProjection()

		expect(await listThreadRows()).toEqual([
			expect.objectContaining({
				provider: 'github',
				kind: 'inline',
				path: 'src/index.ts',
				side: 'right',
				line: 7,
				anchorSha: HEAD_SHA,
				baseSha: BASE_SHA,
				headSha: HEAD_SHA,
				lineExcerpt: 'const value = 2',
				resolvedAt: null,
				resolvedByUserId: null,
			}),
			expect.objectContaining({ provider: 'github', kind: 'top_level' }),
		])
		expect(await listCommentRows()).toEqual([
			expect.objectContaining({
				provider: 'github',
				body: 'Rename this value',
				state: 'published',
				authorUserId: null,
				editedAt: null,
			}),
			expect.objectContaining({
				provider: 'github',
				body: 'Agreed, renaming',
				authorUserId: owner.id,
			}),
			expect.objectContaining({
				provider: 'github',
				body: 'Looks good overall',
				authorUserId: owner.id,
			}),
		])
		expect(await db.query.pullRequestReviews.findMany()).toEqual([
			expect.objectContaining({
				provider: 'github',
				state: 'submitted',
				outcome: 'request_changes',
				body: 'Needs a rename',
				headSha: HEAD_SHA,
				reviewerUserId: null,
				dismissedAt: null,
			}),
		])
		expect(await db.query.pullRequestReviewerRequests.findMany()).toEqual([
			expect.objectContaining({ provider: 'github', reviewerUserId: null }),
			expect.objectContaining({ provider: 'github', reviewerUserId: null }),
		])

		expect(await listCommentMappingNodeIds()).toEqual([
			'issue-comment-node',
			'reply-comment-node',
			'root-comment-node',
		])
		expect(await db.query.gitHubPullRequestThreadMappings.findMany()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalNodeId: 'thread-node',
					rootCommentNodeId: 'root-comment-node',
					providerResolved: false,
					deletedAt: null,
				}),
				expect.objectContaining({
					rootCommentNodeId: 'issue-comment-node',
					deletedAt: null,
				}),
			])
		)
		expect(await db.query.gitHubPullRequestReviewMappings.findMany()).toEqual([
			expect.objectContaining({
				externalNodeId: 'review-node',
				externalNumericId: 31n,
				providerDeletedAt: null,
				providerDismissedAt: null,
			}),
		])
		expect(
			await db.query.gitHubPullRequestReviewerRequestMappings.findMany()
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					targetKind: 'user',
					targetNodeId: unmappedActor.nodeId,
					active: true,
				}),
				expect.objectContaining({
					targetKind: 'team',
					targetNodeId: 'team-node',
					teamSlug: 'platform',
					teamName: 'Platform',
					active: true,
				}),
			])
		)

		expect(await db.query.pullRequestEvents.findMany()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					provider: 'github',
					type: 'review_submitted',
					payload: expect.objectContaining({
						outcome: 'request_changes',
						headSha: HEAD_SHA,
					}),
				}),
			])
		)
		expect(await db.query.gitHubPullRequestEventMappings.findMany()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalKey: 'review-node:review_submitted',
				}),
			])
		)

		const actors = await db.query.gitHubActors.findMany()
		expect(
			actors.find(actor => actor.externalNodeId === mappedActor.nodeId)?.userId
		).toBe(owner.id)
		expect(
			actors.find(actor => actor.externalNodeId === unmappedActor.nodeId)
				?.userId
		).toBeNull()
	})

	test('leaves the projection untouched when the same snapshot is projected again', async () => {
		await runProjection()
		const threads = await listThreadRows()
		const comments = await listCommentRows()
		const reviews = await db.query.pullRequestReviews.findMany()
		const events = await db.query.pullRequestEvents.findMany()

		await runProjection()

		// Every pass rewrites the rows it still sees, so only the row stamp moves.
		expect(await listThreadRows()).toEqual(threads.map(touched))
		expect(await listCommentRows()).toEqual(comments.map(touched))
		expect(await db.query.pullRequestReviews.findMany()).toEqual(
			reviews.map(touched)
		)
		expect(await db.query.pullRequestEvents.findMany()).toEqual(events)
		expect(await db.query.pullRequestReviewerRequests.findMany()).toHaveLength(
			2
		)
		expect(
			await db.query.gitHubPullRequestCommentMappings.findMany()
		).toHaveLength(3)
	})

	test('projects edited comment and review bodies as updates', async () => {
		await runProjection()
		const [projectedComment] = await listCommentRows()
		conversation = {
			...conversation,
			issueComments: [
				{
					...issueComment(),
					body: 'Edited after a second look',
					updatedAt: EDITED_AT,
				},
			],
			reviewComments: [
				{ ...rootComment(), body: 'Edited root', updatedAt: EDITED_AT },
				replyComment(),
			],
			reviews: [{ ...submittedReview(), body: 'Edited review body' }],
		}

		await runProjection()

		const comments = await listCommentRows()
		expect(comments[0]?.id).toBe(projectedComment?.id)
		expect(comments).toEqual([
			expect.objectContaining({ body: 'Edited root', editedAt: EDITED_AT }),
			expect.objectContaining({ body: 'Agreed, renaming', editedAt: null }),
			expect.objectContaining({
				body: 'Edited after a second look',
				editedAt: EDITED_AT,
			}),
		])
		expect(await db.query.pullRequestReviews.findMany()).toEqual([
			expect.objectContaining({ body: 'Edited review body' }),
		])
	})

	test('removes comments GitHub deleted and drops the thread with its last comment', async () => {
		await runProjection()
		conversation = {
			...conversation,
			reviewComments: [rootComment()],
			reviewThreads: [
				{ ...reviewThread(), comments: [{ nodeId: 'root-comment-node' }] },
			],
		}

		await runProjection()

		expect(await listCommentRows()).toEqual([
			expect.objectContaining({ body: 'Rename this value' }),
			expect.objectContaining({ body: 'Looks good overall' }),
		])
		expect(await listThreadRows()).toHaveLength(2)
		expect(await findCommentMapping('reply-comment-node')).toMatchObject({
			pullRequestCommentId: null,
			providerDeletedAt: expect.any(Date),
		})

		conversation = { ...conversation, issueComments: [] }
		await runProjection()

		expect(await listThreadRows()).toEqual([
			expect.objectContaining({ kind: 'inline' }),
		])
		expect(await listCommentRows()).toEqual([
			expect.objectContaining({ body: 'Rename this value' }),
		])
		expect(await findCommentMapping('issue-comment-node')).toMatchObject({
			pullRequestCommentId: null,
			providerDeletedAt: expect.any(Date),
		})
	})

	test('removes a deleted thread whose orphaned reply outlived its root', async () => {
		await runProjection()
		conversation = {
			...conversation,
			reviewComments: [replyComment()],
			reviewThreads: [],
		}

		await runProjection()

		expect(await listThreadRows()).toEqual([
			expect.objectContaining({ kind: 'top_level' }),
		])
		expect(await listCommentRows()).toEqual([
			expect.objectContaining({ body: 'Looks good overall' }),
		])
		// The reply still exists on GitHub, so its mapping keeps the node id and
		// waits for a root to attach to rather than being tombstoned.
		expect(await findCommentMapping('reply-comment-node')).toMatchObject({
			pullRequestCommentId: null,
			providerDeletedAt: null,
		})
		const threadMappings =
			await db.query.gitHubPullRequestThreadMappings.findMany()
		expect(
			threadMappings.find(mapping =>
				mapping.externalNodeId?.endsWith('thread-node')
			)
		).toMatchObject({
			pullRequestThreadId: null,
			deletedAt: expect.any(Date),
		})
	})

	test('records resolution and unresolution against the native thread', async () => {
		await runProjection()
		conversation = {
			...conversation,
			reviewThreads: [
				{ ...reviewThread(), resolved: true, resolvedBy: mappedActor },
			],
		}

		await runProjection()

		expect(await findInlineThread()).toMatchObject({
			resolvedAt: expect.any(Date),
			resolvedByUserId: owner.id,
		})
		expect(await listEventTypes()).toContain('thread_resolved')

		conversation = {
			...conversation,
			reviewThreads: [
				{ ...reviewThread(), resolved: false, resolvedBy: mappedActor },
			],
		}
		await runProjection()

		expect(await findInlineThread()).toMatchObject({
			resolvedAt: null,
			resolvedByUserId: null,
		})
		expect(await listEventTypes()).toContain('thread_unresolved')
	})

	test('leaves resolution untouched when GraphQL returns no thread information', async () => {
		conversation = {
			...conversation,
			reviewThreads: [
				{ ...reviewThread(), resolved: true, resolvedBy: mappedActor },
			],
		}
		await runProjection()
		const resolvedThread = await findInlineThread()
		conversation = { ...conversation, reviewThreads: [] }

		await runProjection()

		expect(await findInlineThread()).toMatchObject({
			id: resolvedThread?.id,
			resolvedAt: resolvedThread?.resolvedAt,
			resolvedByUserId: owner.id,
		})
		expect(
			(await listEventTypes()).filter(type => type === 'thread_unresolved')
		).toHaveLength(0)
	})

	test('keeps a dismissed review out of the effective state but in history', async () => {
		await runProjection()
		conversation = {
			...conversation,
			reviews: [{ ...submittedReview(), outcome: undefined, dismissed: true }],
		}

		await runProjection()

		expect(await db.query.pullRequestReviews.findMany()).toEqual([
			expect.objectContaining({
				state: 'dismissed',
				outcome: 'request_changes',
				dismissedAt: expect.any(Date),
			}),
		])
		const detail = await getPullRequestDetail()
		expect(detail.effectiveReviewStates).toEqual([])
		expect(detail.reviews).toEqual([
			expect.objectContaining({
				state: 'dismissed',
				outcome: 'request_changes',
				reviewer: expect.objectContaining({ username: 'octo' }),
			}),
		])
	})

	test('records a review first seen dismissed without inventing an outcome', async () => {
		conversation = {
			...conversation,
			reviews: [{ ...submittedReview(), outcome: undefined, dismissed: true }],
		}

		await runProjection()

		expect(await db.query.pullRequestReviews.findMany()).toEqual([
			expect.objectContaining({
				provider: 'github',
				state: 'dismissed',
				outcome: null,
				dismissedAt: expect.any(Date),
			}),
		])
		const detail = await getPullRequestDetail()
		expect(detail.effectiveReviewStates).toEqual([])
		expect(detail.reviews).toEqual([
			expect.objectContaining({ state: 'dismissed' }),
		])
		expect(detail.reviews[0]?.outcome).toBeUndefined()
	})

	test('keeps two unmapped reviewers distinct in the effective state', async () => {
		conversation = {
			...conversation,
			reviews: [
				{ ...submittedReview(), outcome: 'approve' },
				{
					...submittedReview(),
					nodeId: 'review-node-2',
					numericId: 32n,
					reviewer: otherUnmappedActor,
					outcome: 'approve',
					body: 'Looks fine to me',
				},
			],
		}

		await runProjection()

		const { effectiveReviewStates } = await getPullRequestDetail()
		expect(effectiveReviewStates).toHaveLength(2)
		expect(effectiveReviewStates.map(state => state.reviewer.username)).toEqual(
			expect.arrayContaining(['octo', 'nova'])
		)
		expect(
			new Set(effectiveReviewStates.map(state => state.reviewer.key)).size
		).toBe(2)
	})

	test('renders a GitHub-outdated thread as outdated at the current head', async () => {
		await runProjection()
		expect((await listThreads()).threads).toEqual([
			expect.objectContaining({ kind: 'inline', outdated: false }),
			expect.objectContaining({ kind: 'top_level' }),
		])

		conversation = {
			...conversation,
			reviewThreads: [{ ...reviewThread(), outdated: true }],
		}
		await runProjection()

		const threads = await listThreads()
		expect(threads.comparison).toMatchObject({
			baseSha: BASE_SHA,
			headSha: HEAD_SHA,
		})
		expect(threads.threads).toEqual([
			expect.objectContaining({ kind: 'inline', outdated: true }),
			expect.objectContaining({ kind: 'top_level' }),
		])
	})

	test('exposes external actors and links while requiring GitHub reconnect for writes', async () => {
		await runProjection()

		const threads = await listThreads()
		expect(threads.viewer).toEqual({
			canComment: true,
			canResolveAnyThread: true,
			canDeleteAnyComment: true,
		})
		expect(threads.threads[0]?.comments).toEqual([
			expect.objectContaining({
				body: 'Rename this value',
				author: expect.objectContaining({
					provider: 'github',
					username: 'octo',
				}),
				sourceUrl: `${PULL_REQUEST_URL}#discussion_r21`,
			}),
			expect.objectContaining({
				author: expect.objectContaining({
					username: 'maya',
					userId: owner.id,
				}),
			}),
		])
		expect(threads.threads[0]?.comments[0]?.author.userId).toBeFalsy()

		const detail = await getPullRequestDetail()
		expect(detail.authority).toBe('github')
		expect(detail.viewer).toEqual({
			allowedOutcomes: ['approve', 'request_changes', 'comment'],
			canRequestReviewers: true,
			canRemoveReviewerRequests: true,
		})
		expect(detail.reviews[0]?.sourceUrl).toBe(
			`${PULL_REQUEST_URL}#pullrequestreview-31`
		)
		expect(detail.reviewerRequests).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ targetKind: 'team' }),
				expect.objectContaining({
					targetKind: 'user',
					reviewer: expect.objectContaining({ username: 'octo' }),
				}),
			])
		)

		const reconnectRequired = await request(
			'http://localhost/repositories/maya/notes/pulls/1/threads',
			'POST',
			owner.headers,
			{ body: 'Native comment' }
		)
		expect(reconnectRequired.status).toBe(401)
		expect(await reconnectRequired.json()).toMatchObject({
			code: 'UNAUTHORIZED',
			message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
		})
	})

	test('projects a pull request a signed delivery names outside the cursor page', async () => {
		await runProjection()
		conversation = {
			...conversation,
			issueComments: [issueComment(), secondIssueComment()],
		}
		reconciledPullRequests = []
		const deliveryId = crypto.randomUUID()

		const received = await postWebhook(
			deliveryId,
			'issue_comment',
			issueCommentDelivery()
		)
		expect(received.status).toBe(202)
		expect(await received.json()).toEqual({ accepted: true, duplicate: false })
		expect(enqueue).toHaveBeenCalledTimes(1)
		expect(await findExternalSource()).toMatchObject({
			requestedSyncVersion: 2,
		})

		await drainSyncQueue()

		expect(await listCommentRows()).toEqual([
			expect.objectContaining({ body: 'Rename this value' }),
			expect.objectContaining({ body: 'Agreed, renaming' }),
			expect.objectContaining({ body: 'Looks good overall' }),
			expect.objectContaining({ body: 'One more thing' }),
		])
		expect(await db.query.gitHubWebhookDeliveries.findMany()).toEqual([
			expect.objectContaining({
				id: deliveryId,
				eventName: 'issue_comment',
				action: 'created',
				subjectNumber: 1,
				issueNumber: 1,
				targetResourceKind: 'issue_comment',
				targetResourceNodeId: 'issue-comment-2-node',
				status: 'processed',
			}),
		])
	})

	test('treats a repeated delivery identifier as a no-op', async () => {
		await runProjection()
		const deliveryId = crypto.randomUUID()
		await postWebhook(deliveryId, 'issue_comment', issueCommentDelivery())
		enqueue.mockClear()

		const repeated = await postWebhook(
			deliveryId,
			'issue_comment',
			issueCommentDelivery()
		)

		expect(repeated.status).toBe(202)
		expect(await repeated.json()).toEqual({ accepted: true, duplicate: true })
		expect(await db.query.gitHubWebhookDeliveries.findMany()).toHaveLength(1)
		expect(await findExternalSource()).toMatchObject({
			requestedSyncVersion: 2,
		})
	})

	function pullRequestSnapshot(): GitHubSyncPullRequest {
		return {
			nodeId: 'pull-request-node',
			numericId: 900n,
			number: 1,
			htmlUrl: PULL_REQUEST_URL,
			title: 'Rename the value',
			body: 'Renames the value',
			state: 'open',
			draft: false,
			labels: [],
			assignees: [],
			author: authorActor,
			sourceBranch: 'feature',
			targetBranch: 'main',
			baseRepositoryNodeId: 'repository-node',
			headRepositoryNodeId: 'repository-node',
			headSha: HEAD_SHA,
			baseSha: BASE_SHA,
			createdAt: new Date('2026-08-01T09:00:00Z'),
			updatedAt: new Date('2026-08-01T10:30:00Z'),
		}
	}

	function fullConversation(): GitHubPullRequestConversation {
		return {
			issueComments: [issueComment()],
			reviewComments: [rootComment(), replyComment()],
			reviews: [submittedReview()],
			requestedReviewers: [
				{ kind: 'user', actor: unmappedActor },
				{
					kind: 'team',
					nodeId: 'team-node',
					numericId: 9n,
					slug: 'platform',
					name: 'Platform',
					htmlUrl: 'https://github.com/orgs/tessera-org/teams/platform',
				},
			],
			reviewThreads: [reviewThread()],
		}
	}

	function issueComment(): GitHubSyncIssueComment {
		return {
			nodeId: 'issue-comment-node',
			numericId: 11n,
			author: mappedActor,
			body: 'Looks good overall',
			htmlUrl: `${PULL_REQUEST_URL}#issuecomment-11`,
			createdAt: ISSUE_COMMENT_CREATED_AT,
			updatedAt: ISSUE_COMMENT_CREATED_AT,
		}
	}

	function secondIssueComment(): GitHubSyncIssueComment {
		return {
			nodeId: 'issue-comment-2-node',
			numericId: 12n,
			author: unmappedActor,
			body: 'One more thing',
			htmlUrl: `${PULL_REQUEST_URL}#issuecomment-12`,
			createdAt: new Date('2026-08-02T08:00:00Z'),
			updatedAt: new Date('2026-08-02T08:00:00Z'),
		}
	}

	function rootComment(): GitHubSyncReviewComment {
		return {
			nodeId: 'root-comment-node',
			numericId: 21n,
			author: unmappedActor,
			body: 'Rename this value',
			htmlUrl: `${PULL_REQUEST_URL}#discussion_r21`,
			reviewNumericId: 31n,
			subjectType: 'line',
			path: 'src/index.ts',
			side: 'right',
			line: 7,
			originalLine: 7,
			commitId: HEAD_SHA,
			originalCommitId: HEAD_SHA,
			diffHunk: DIFF_HUNK,
			createdAt: ROOT_CREATED_AT,
			updatedAt: ROOT_CREATED_AT,
		}
	}

	function replyComment(): GitHubSyncReviewComment {
		return {
			...rootComment(),
			nodeId: 'reply-comment-node',
			numericId: 22n,
			author: mappedActor,
			body: 'Agreed, renaming',
			htmlUrl: `${PULL_REQUEST_URL}#discussion_r22`,
			reviewNumericId: undefined,
			inReplyToNumericId: 21n,
			createdAt: REPLY_CREATED_AT,
			updatedAt: REPLY_CREATED_AT,
		}
	}

	function submittedReview(): GitHubSyncReview {
		return {
			nodeId: 'review-node',
			numericId: 31n,
			reviewer: unmappedActor,
			body: 'Needs a rename',
			outcome: 'request_changes',
			dismissed: false,
			htmlUrl: `${PULL_REQUEST_URL}#pullrequestreview-31`,
			commitId: HEAD_SHA,
			submittedAt: REVIEW_SUBMITTED_AT,
		}
	}

	function reviewThread(): GitHubSyncReviewThread {
		return {
			nodeId: 'thread-node',
			resolved: false,
			outdated: false,
			subjectType: 'line',
			path: 'src/index.ts',
			line: 7,
			side: 'right',
			comments: [
				{ nodeId: 'root-comment-node', originalCommitSha: HEAD_SHA },
				{
					nodeId: 'reply-comment-node',
					replyToNodeId: 'root-comment-node',
					originalCommitSha: HEAD_SHA,
				},
			],
		}
	}

	function issueCommentDelivery() {
		return {
			action: 'created',
			installation: { id: EXTERNAL_INSTALLATION_ID },
			repository: { id: EXTERNAL_REPOSITORY_ID, node_id: 'repository-node' },
			sender: {
				id: Number(unmappedActor.numericId),
				node_id: unmappedActor.nodeId,
				login: unmappedActor.login,
				type: 'User',
			},
			issue: { number: 1, pull_request: { html_url: PULL_REQUEST_URL } },
			comment: {
				id: 12,
				node_id: 'issue-comment-2-node',
				html_url: `${PULL_REQUEST_URL}#issuecomment-12`,
			},
		}
	}

	async function runProjection() {
		await db.update(repositoryExternalSources).set({ nextSyncAt: new Date() })
		enqueue.mockClear()
		await processor.process(
			createJob(GITHUB_SYNC_DISPATCHER_JOB, { type: 'dispatcher' })
		)
		await drainSyncQueue()
	}

	async function drainSyncQueue() {
		const requests = enqueue.mock.calls.map(
			([request]) => request as GitHubSyncRequest
		)
		enqueue.mockClear()

		for (const request of requests)
			await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
	}

	function touched<TRow extends { updatedAt: Date }>(row: TRow) {
		return { ...row, updatedAt: expect.any(Date) }
	}

	function createJob(name: string, data: GitHubSyncJobData) {
		return { name, data } as Job<GitHubSyncJobData>
	}

	function listThreadRows() {
		return db.query.pullRequestThreads.findMany({
			orderBy: (threads, { asc }) => asc(threads.createdAt),
		})
	}

	function listCommentRows() {
		return db.query.pullRequestComments.findMany({
			orderBy: (comments, { asc }) => asc(comments.createdAt),
		})
	}

	async function listCommentMappingNodeIds() {
		const mappings = await db.query.gitHubPullRequestCommentMappings.findMany()

		return mappings.map(mapping => mapping.externalNodeId).sort()
	}

	async function findCommentMapping(externalNodeId: string) {
		return await db.query.gitHubPullRequestCommentMappings.findFirst({
			where: (mappings, { eq }) => eq(mappings.externalNodeId, externalNodeId),
		})
	}

	async function findInlineThread() {
		return await db.query.pullRequestThreads.findFirst({
			where: (threads, { eq }) => eq(threads.kind, 'inline'),
		})
	}

	async function listEventTypes() {
		const events = await db.query.pullRequestEvents.findMany()

		return events.map(event => event.type)
	}

	async function findExternalSource() {
		return await db.query.repositoryExternalSources.findFirst()
	}

	async function listThreads() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/maya/notes/pulls/1/threads',
			{ headers: owner.headers }
		)

		return (await response.json()) as ThreadsResponseBody
	}

	async function getPullRequestDetail() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/maya/notes/pulls/1',
			{ headers: owner.headers }
		)

		return (await response.json()) as PullRequestResponseBody
	}

	function postWebhook(deliveryId: string, eventName: string, payload: object) {
		const body = JSON.stringify(payload)
		const headers = new Headers({
			'content-type': 'application/json',
			'x-github-delivery': deliveryId,
			'x-github-event': eventName,
			'x-hub-signature-256': `sha256=${createHmac('sha256', WEBHOOK_SECRET)
				.update(body)
				.digest('hex')}`,
		})

		return adapter.hono.request('http://localhost/webhooks/github', {
			method: 'POST',
			headers,
			body,
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
		if (!createdUser) throw new Error('Failed to create integration user')
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

	async function createMirroredRepository() {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			owner.headers,
			{ name: 'Notes', slug: 'notes', visibility: 'public' }
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		const repository = await db.query.repositories.findFirst()
		if (!repository) throw new Error('Repository missing')

		const [installation] = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId: BigInt(EXTERNAL_INSTALLATION_ID),
				accountNodeId: 'organization-node',
				accountLogin: 'tessera-org',
				targetType: 'organization',
			})
			.returning({ id: gitHubInstallations.id })
		if (!installation) throw new Error('Failed to create GitHub installation')

		await db.insert(repositoryExternalSources).values({
			repositoryId: repository.id,
			provider: 'github',
			installationId: installation.id,
			externalRepositoryNodeId: 'repository-node',
			externalRepositoryId: BigInt(EXTERNAL_REPOSITORY_ID),
			ownerLogin: 'tessera-org',
			name: 'notes',
			fullName: 'tessera-org/notes',
			sourceUrl: 'https://github.com/tessera-org/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'pending',
			nextSyncAt: new Date(),
		})
	}

	function request(
		url: string,
		method: 'DELETE' | 'PATCH' | 'POST',
		headers?: Headers,
		body?: object
	) {
		const requestHeaders = new Headers(headers)
		if (body) requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(url, {
			method,
			headers: requestHeaders,
			body: body ? JSON.stringify(body) : undefined,
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(gitHubPullRequestEventMappings)
		await db.delete(gitHubPullRequestCommentMappings)
		await db.delete(gitHubPullRequestReviewerRequestMappings)
		await db.delete(gitHubPullRequestReviewMappings)
		await db.delete(gitHubPullRequestThreadMappings)
		await db.delete(gitHubPullRequestMappings)
		await db.delete(gitHubWebhookDeliveries)
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
})

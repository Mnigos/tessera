import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import {
	account,
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
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MOVED_HEAD_SHA = 'c'.repeat(40)

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
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class PullRequestReviewsIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

describe('Pull request reviews integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let currentHeadSha: string
	let owner: IntegrationUser
	let reviewer: IntegrationUser
	let otherUser: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		moduleRef = await Test.createTestingModule({
			imports: [PullRequestReviewsIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
					})
				),
				listRepositoryRefs: vi.fn().mockImplementation(() =>
					Promise.resolve({
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
								target: currentHeadSha,
							},
						],
						tags: [],
					})
				),
				compareRepositoryRefs: vi.fn().mockImplementation(() =>
					Promise.resolve({
						baseSha: BASE_SHA,
						headSha: currentHeadSha,
						mergeBaseSha: BASE_SHA,
						commits: [],
						files: [],
						isTruncated: false,
						commitsTruncated: false,
						commitLimit: 500,
						fileLimit: 300,
					})
				),
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		currentHeadSha = HEAD_SHA
		owner = await createIntegrationUser('owner')
		reviewer = await createIntegrationUser('reviewer')
		otherUser = await createIntegrationUser('other')
		await createRepository(owner.headers)
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls',
			'POST',
			owner.headers,
			{ sourceBranch: 'feature', targetBranch: 'main', title: 'Feature' }
		)
		if (response.status !== 200)
			throw new Error(`Failed to create pull request: ${response.status}`)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('runs the sealed pending-review lifecycle over HTTP', async () => {
		const requested = await reviewAction('reviewers', 'POST', owner.headers, {
			reviewerUsername: reviewer.username,
		})
		expect(requested.status).toBe(200)
		expect(await requested.json()).toMatchObject({
			reviewerUsername: reviewer.username,
			requestedByUsername: owner.username,
		})
		const requestEvent = await db.query.pullRequestEvents.findFirst({
			where: (events, { eq }) => eq(events.type, 'review_requested'),
		})
		expect(requestEvent?.payload).toEqual({
			reviewerUserId: reviewer.id,
			reviewerUsername: reviewer.username,
		})

		const draftThreadResponse = await request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			'POST',
			reviewer.headers,
			{
				body: 'Please cover this edge case',
				review: { expectedHeadSha: HEAD_SHA },
			}
		)
		expect(draftThreadResponse.status).toBe(200)
		const draftThread = (await draftThreadResponse.json()) as { id: string }
		expect(await listThreads(reviewer.headers)).toMatchObject({
			threads: [{ id: draftThread.id, comments: [{ state: 'pending' }] }],
		})
		expect(await listThreads(owner.headers)).toMatchObject({ threads: [] })
		expect(await listThreads(otherUser.headers)).toMatchObject({ threads: [] })

		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'request_changes',
			body: 'Please revise',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		expect(await submitted.json()).toMatchObject({
			outcome: 'request_changes',
			headSha: HEAD_SHA,
		})
		expect(await listThreads(owner.headers)).toMatchObject({
			threads: [{ id: draftThread.id, comments: [{ state: 'published' }] }],
		})
		const submittedEvent = await db.query.pullRequestEvents.findFirst({
			where: (events, { eq }) => eq(events.type, 'review_submitted'),
		})
		expect(submittedEvent?.payload).toMatchObject({
			outcome: 'request_changes',
			headSha: HEAD_SHA,
		})
		expect(
			await db.query.pullRequestReviewerRequests.findFirst()
		).toMatchObject({
			fulfilledByReviewId: expect.any(String),
		})

		currentHeadSha = MOVED_HEAD_SHA
		const staleDetail = await getPullRequest(reviewer.headers)
		expect(staleDetail.effectiveReviewStates).toEqual([
			expect.objectContaining({ outcome: 'request_changes', stale: true }),
		])

		expect(
			(
				await reviewAction('reviewers', 'POST', owner.headers, {
					reviewerUsername: reviewer.username,
				})
			).status
		).toBe(200)
		const approved = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: MOVED_HEAD_SHA,
		})
		expect(approved.status).toBe(200)
		expect(
			(await getPullRequest(reviewer.headers)).effectiveReviewStates
		).toEqual([expect.objectContaining({ outcome: 'approve', stale: false })])

		await request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			'POST',
			reviewer.headers,
			{
				body: 'Discard me',
				review: { expectedHeadSha: MOVED_HEAD_SHA },
			}
		)
		const beforeDiscard = await getPullRequest(reviewer.headers)
		expect(beforeDiscard.viewerPendingReview).toMatchObject({ commentCount: 1 })
		const discarded = await reviewAction(
			'reviews/pending',
			'DELETE',
			reviewer.headers
		)
		expect(await discarded.json()).toEqual({ discarded: true })
		expect(
			(await getPullRequest(reviewer.headers)).viewerPendingReview
		).toBeUndefined()
		expect(
			await db.query.pullRequestComments.findFirst({
				where: (comments, { eq }) => eq(comments.state, 'pending'),
			})
		).toBeUndefined()
		expect((await listThreads(reviewer.headers)).threads).toHaveLength(1)

		const authorSubmission = await reviewAction(
			'reviews',
			'POST',
			owner.headers,
			{
				outcome: 'approve',
				expectedHeadSha: MOVED_HEAD_SHA,
			}
		)
		expect(authorSubmission.status).toBe(403)
		expect(await authorSubmission.json()).toMatchObject({
			code: 'FORBIDDEN',
		})

		const detail = await getPullRequest(reviewer.headers)
		expect(detail).toMatchObject({
			effectiveReviewStates: [{ outcome: 'approve', stale: false }],
			viewer: {
				canSubmitReview: true,
				canRequestReviewers: false,
				canRemoveReviewerRequests: false,
			},
		})
		const listResponse = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls',
			{ headers: reviewer.headers }
		)
		expect(await listResponse.json()).toMatchObject({
			pullRequests: [
				{
					reviewSummary: {
						approvedCount: 1,
						changeRequestCount: 0,
						staleCount: 0,
					},
				},
			],
		})
	})

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

	async function createRepository(headers: Headers) {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			headers,
			{ name: 'Notes', slug: 'notes', visibility: 'public' }
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)
	}

	async function listThreads(headers: Headers) {
		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			{ headers }
		)
		return (await response.json()) as { threads: object[] }
	}

	async function getPullRequest(headers: Headers) {
		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1',
			{ headers }
		)
		return (await response.json()) as {
			effectiveReviewStates: object[]
			viewerPendingReview?: { commentCount: number }
			viewer: object
		}
	}

	function reviewAction(
		path: string,
		method: 'DELETE' | 'POST',
		headers: Headers,
		body?: object
	) {
		return request(
			`http://localhost/repositories/owner/notes/pulls/1/${path}`,
			method,
			headers,
			body
		)
	}

	function request(
		url: string,
		method: 'DELETE' | 'POST',
		headers: Headers,
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
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})

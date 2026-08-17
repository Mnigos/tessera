import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { status } from '@grpc/grpc-js'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE } from '@repo/contracts'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	gitHubActors,
	gitHubPullRequestMappings,
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
import type { PullRequestReviewId, UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ExternalServiceError } from '~/shared/errors'

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
	let gitStorageCompareRepositoryRefs: ReturnType<typeof vi.fn>
	let owner: IntegrationUser
	let reviewer: IntegrationUser
	let otherUser: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
		gitStorageCompareRepositoryRefs = vi.fn()

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
							{
								type: 'branch',
								name: 'feature-two',
								qualifiedName: 'refs/heads/feature-two',
								target: currentHeadSha,
							},
						],
						tags: [],
					})
				),
				// Branch names resolve to whichever commits they point at now; an exact
				// object id resolves to itself, which is how the reviewed commit is
				// compared against the current head.
				compareRepositoryRefs: gitStorageCompareRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		currentHeadSha = HEAD_SHA
		gitStorageCompareRepositoryRefs.mockReset()
		gitStorageCompareRepositoryRefs.mockImplementation(
			({ baseRef, headRef }) => {
				const baseSha = baseRef === 'main' ? BASE_SHA : baseRef
				const headSha = headRef === 'feature' ? currentHeadSha : headRef

				return Promise.resolve({
					baseSha,
					headSha,
					mergeBaseSha: baseSha,
					commits: [],
					files: [],
					isTruncated: false,
					commitsTruncated: false,
					commitLimit: 500,
					fileLimit: 300,
				})
			}
		)
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
			targetKind: 'user',
			reviewer: { username: reviewer.username, provider: 'tessera' },
			requestedBy: { username: owner.username, provider: 'tessera' },
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
				allowedOutcomes: ['approve', 'request_changes', 'comment'],
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

	test('enforces author outcomes and publishes an author comment review', async () => {
		const authorDetail = await getPullRequest(owner.headers)
		const readerDetail = await getPullRequest(reviewer.headers)
		expect(authorDetail.viewer).toMatchObject({ allowedOutcomes: ['comment'] })
		expect(readerDetail.viewer).toMatchObject({
			allowedOutcomes: ['approve', 'request_changes', 'comment'],
		})

		const draftResponse = await request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			'POST',
			owner.headers,
			{
				body: 'Author context',
				review: { expectedHeadSha: HEAD_SHA },
			}
		)
		expect(draftResponse.status).toBe(200)

		const commentReview = await reviewAction('reviews', 'POST', owner.headers, {
			outcome: 'comment',
			body: 'Context only',
			expectedHeadSha: HEAD_SHA,
		})
		expect(commentReview.status).toBe(200)
		expect(await commentReview.json()).toMatchObject({
			state: 'submitted',
			outcome: 'comment',
		})
		expect(await listThreads(owner.headers)).toMatchObject({
			threads: [{ comments: [{ body: 'Author context', state: 'published' }] }],
		})

		const approve = await reviewAction('reviews', 'POST', owner.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(approve.status).toBe(403)
		expect(await approve.json()).toMatchObject({
			code: 'FORBIDDEN',
			message: PULL_REQUEST_AUTHOR_REVIEW_FORBIDDEN_MESSAGE,
		})
	})

	test('reads what a submitted review has not seen over HTTP', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: PullRequestReviewId }

		// Readable like the pull request's own comparison: no session, no reviewer
		// identity, and no write authority.
		const unchanged = await getReviewComparison(review.id)
		expect(unchanged.status).toBe(200)
		expect(await unchanged.json()).toMatchObject({
			status: 'nothing_new',
			review: {
				id: review.id,
				reviewer: { username: reviewer.username },
				state: 'submitted',
				outcome: 'approve',
				headSha: HEAD_SHA,
			},
			canonicalBaseSha: BASE_SHA,
			currentHeadSha: HEAD_SHA,
		})

		currentHeadSha = MOVED_HEAD_SHA
		const moved = await getReviewComparison(review.id)
		expect(moved.status).toBe(200)
		expect(await moved.json()).toMatchObject({
			status: 'ready',
			canonicalBaseSha: BASE_SHA,
			currentHeadSha: MOVED_HEAD_SHA,
			historiesDiverged: false,
			comparison: {
				baseSha: HEAD_SHA,
				headSha: MOVED_HEAD_SHA,
				commitLimit: 500,
				fileLimit: 300,
			},
		})

		const draftThread = await reviewAction(
			'threads',
			'POST',
			reviewer.headers,
			{
				body: 'Not submitted yet',
				review: { expectedHeadSha: MOVED_HEAD_SHA },
			}
		)
		expect(draftThread.status).toBe(200)
		const pendingReview = await db.query.pullRequestReviews.findFirst({
			where: (reviews, { eq }) => eq(reviews.state, 'pending'),
		})
		if (!pendingReview) throw new Error('Failed to open a pending review')

		// A sealed review stays sealed: naming its id says no more than naming one
		// that never existed.
		expect((await getReviewComparison(pendingReview.id)).status).toBe(404)
		expect((await getReviewComparison(crypto.randomUUID())).status).toBe(404)
	})

	test('hides a review belonging to another pull request like an unknown review', async () => {
		const secondPullRequest = await request(
			'http://localhost/repositories/owner/notes/pulls',
			'POST',
			owner.headers,
			{ sourceBranch: 'feature-two', targetBranch: 'main', title: 'Second' }
		)
		expect(secondPullRequest.status).toBe(200)
		const submitted = await reviewAction(
			'reviews',
			'POST',
			reviewer.headers,
			{ outcome: 'approve', expectedHeadSha: HEAD_SHA },
			2
		)
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }

		const otherPullRequestResponse = await getReviewComparison(review.id)
		const unknownResponse = await getReviewComparison(crypto.randomUUID())

		expect(otherPullRequestResponse.status).toBe(unknownResponse.status)
		expect(await otherPullRequestResponse.json()).toEqual(
			await unknownResponse.json()
		)
	})

	test('compares a dismissed submitted review', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: PullRequestReviewId }
		await db
			.update(pullRequestReviews)
			.set({
				state: 'dismissed',
				dismissedAt: new Date(),
				dismissedByUserId: owner.id,
			})
			.where(eq(pullRequestReviews.id, review.id))

		const response = await getReviewComparison(review.id)
		const body = (await response.json()) as {
			status: string
			review: { state: string }
		}

		expect(response.status).toBe(200)
		expect(['ready', 'nothing_new']).toContain(body.status)
		expect(body.review.state).toBe('dismissed')
	})

	test('uses the same readable-repository authorization as comparison', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }
		await db.update(repositories).set({ visibility: 'private' })

		expect((await getReviewComparison(review.id, owner.headers)).status).toBe(
			200
		)
		for (const headers of [otherUser.headers, undefined]) {
			const reviewResponse = await getReviewComparison(review.id, headers)
			const comparisonResponse = await getComparison(headers)

			expect(reviewResponse.status).toBe(comparisonResponse.status)
		}
	})

	test('reports a missing reviewed head over HTTP', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }
		currentHeadSha = MOVED_HEAD_SHA
		gitStorageCompareRepositoryRefs
			.mockResolvedValueOnce(comparisonResult(BASE_SHA, MOVED_HEAD_SHA))
			.mockRejectedValueOnce(missingGitObjectError())

		const response = await getReviewComparison(review.id)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			status: 'review_head_unavailable',
		})
	})

	test('keeps a missing canonical comparison as an HTTP error', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }
		gitStorageCompareRepositoryRefs.mockRejectedValueOnce(
			missingGitObjectError()
		)

		expect((await getReviewComparison(review.id)).status).toBe(502)
	})

	test('preserves interdiff truncation metadata', async () => {
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }
		currentHeadSha = MOVED_HEAD_SHA
		gitStorageCompareRepositoryRefs
			.mockResolvedValueOnce(comparisonResult(BASE_SHA, MOVED_HEAD_SHA))
			.mockResolvedValueOnce({
				...comparisonResult(HEAD_SHA, MOVED_HEAD_SHA),
				commitsTruncated: true,
				isTruncated: true,
				commitLimit: 17,
				fileLimit: 23,
			})

		const response = await getReviewComparison(review.id)

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			comparison: {
				commitsTruncated: true,
				isTruncated: true,
				commitLimit: 17,
				fileLimit: 23,
			},
		})
	})

	test('compares a GitHub-mapped pull request using its stored SHAs', async () => {
		const pullRequest = await db.query.pullRequests.findFirst()
		const repository = await db.query.repositories.findFirst()
		if (!(pullRequest && repository))
			throw new Error('Failed to find integration pull request')
		const submitted = await reviewAction('reviews', 'POST', reviewer.headers, {
			outcome: 'approve',
			expectedHeadSha: HEAD_SHA,
		})
		expect(submitted.status).toBe(200)
		const review = (await submitted.json()) as { id: string }
		const [actor] = await db
			.insert(gitHubActors)
			.values({
				externalNodeId: 'github-owner-node',
				externalNumericId: 1n,
				login: owner.username,
				type: 'user',
			})
			.returning({ id: gitHubActors.id })
		if (!actor) throw new Error('Failed to create GitHub actor')
		const storedBaseSha = 'e'.repeat(40)
		const storedHeadSha = 'f'.repeat(40)
		await db.insert(gitHubPullRequestMappings).values({
			repositoryId: repository.id,
			pullRequestId: pullRequest.id,
			externalNodeId: 'github-pr-node',
			externalNumericId: 101n,
			externalNumber: 1,
			htmlUrl: 'https://github.com/owner/notes/pull/1',
			authorActorId: actor.id,
			headRepositoryNodeId: 'github-repository-node',
			baseRepositoryNodeId: 'github-repository-node',
			headSha: storedHeadSha,
			baseSha: storedBaseSha,
			providerCreatedAt: new Date(),
			providerUpdatedAt: new Date(),
			lastSyncedAt: new Date(),
		})
		gitStorageCompareRepositoryRefs.mockResolvedValueOnce(
			comparisonResult(storedBaseSha, storedHeadSha)
		)

		const response = await getReviewComparison(review.id)

		expect(response.status).toBe(200)
		expect(gitStorageCompareRepositoryRefs).toHaveBeenNthCalledWith(1, {
			repositoryId: repository.id,
			storagePath: repository.storagePath,
			baseRef: storedBaseSha,
			headRef: storedHeadSha,
		})
		expect(await response.json()).toMatchObject({ status: 'ready' })
	})

	function getReviewComparison(reviewId: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/1/reviews/${reviewId}/comparison`,
			{ headers }
		)
	}

	function getComparison(headers?: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1/comparison',
			{ headers }
		)
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
		body?: object,
		number = 1
	) {
		return request(
			`http://localhost/repositories/owner/notes/pulls/${number}/${path}`,
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
		await db.delete(gitHubPullRequestMappings)
		await db.delete(gitHubActors)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}

	function comparisonResult(baseSha: string, headSha: string) {
		return {
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			commits: [],
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		}
	}

	function missingGitObjectError() {
		const error = Object.assign(new Error('object not found'), {
			code: status.NOT_FOUND,
			details: 'object not found',
		})

		return new ExternalServiceError(
			'git storage',
			{ grpcCode: status.NOT_FOUND, grpcDetails: 'object not found' },
			undefined,
			{ cause: error }
		)
	}
})

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
import {
	PULL_REQUEST_STALE_COMPARISON_MESSAGE,
	type PullRequestActor,
} from '@repo/contracts'
import { db } from '@repo/db/client'
import {
	account,
	pullRequestComments,
	pullRequestEvents,
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
import type { PullRequestThreadId, UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
const MOVED_HEAD_SHA = 'c'.repeat(40)
const RELEASE_SHA = 'd'.repeat(40)
const BRANCHES = [
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
	{
		type: 'branch',
		name: 'release',
		qualifiedName: 'refs/heads/release',
		target: RELEASE_SHA,
	},
]

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
class PullRequestThreadsIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ThreadResponseBody {
	id: PullRequestThreadId
	kind: 'top_level' | 'inline'
	anchor?: { startLine: number; endLine: number }
	outdated: boolean
	resolved?: { by: PullRequestActor }
	comments: { id: string; body: string; author: PullRequestActor }[]
}

describe('Pull request threads integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let compareRepositoryRefs: ReturnType<typeof vi.fn>
	let listRepositoryRefs: ReturnType<typeof vi.fn>
	let owner: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		compareRepositoryRefs = vi.fn()
		listRepositoryRefs = vi.fn()
		moduleRef = await Test.createTestingModule({
			imports: [PullRequestThreadsIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
					})
				),
				listRepositoryRefs,
				compareRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		compareRepositoryRefs.mockReset()
		compareRepositoryRefs.mockResolvedValue(comparison(HEAD_SHA))
		listRepositoryRefs.mockReset()
		listRepositoryRefs.mockResolvedValue({ branches: BRANCHES, tags: [] })
		owner = await createIntegrationUser('owner')
		await createRepository('private', owner.headers)
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

	test('runs the full top-level and inline thread lifecycle over HTTP', async () => {
		const topLevel = await createThread({ body: 'Top level' }, owner.headers)
		expect(topLevel.status).toBe(200)
		const topLevelThread = (await topLevel.json()) as ThreadResponseBody
		expect(topLevelThread).toMatchObject({ kind: 'top_level', outdated: false })

		const inline = await createThread(
			{
				body: 'Inline',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 7,
					endLine: 7,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const value = 1',
				},
			},
			owner.headers
		)
		expect(inline.status).toBe(200)
		const inlineThread = (await inline.json()) as ThreadResponseBody

		const reply = await threadAction(
			inlineThread.id,
			'comments',
			'POST',
			owner.headers,
			{ body: 'Reply' }
		)
		expect(reply.status).toBe(200)
		const repliedThread = (await reply.json()) as ThreadResponseBody
		expect(repliedThread.comments).toHaveLength(2)

		const edited = await commentAction(
			repliedThread.comments[1]?.id ?? '',
			'PATCH',
			owner.headers,
			{ body: 'Edited reply' }
		)
		expect(edited.status).toBe(200)
		expect(await edited.json()).toMatchObject({ body: 'Edited reply' })

		const resolved = await threadAction(
			inlineThread.id,
			'resolve',
			'POST',
			owner.headers
		)
		expect(resolved.status).toBe(200)
		expect(await resolved.json()).toMatchObject({
			resolved: { by: { username: 'owner', provider: 'tessera' } },
		})
		const unresolved = await threadAction(
			inlineThread.id,
			'unresolve',
			'POST',
			owner.headers
		)
		expect(unresolved.status).toBe(200)
		expect((await unresolved.json()) as ThreadResponseBody).not.toHaveProperty(
			'resolved'
		)

		const deleteReply = await commentAction(
			repliedThread.comments[1]?.id ?? '',
			'DELETE',
			owner.headers
		)
		expect(await deleteReply.json()).toEqual({ threadDeleted: false })
		const deleteTopLevel = await commentAction(
			topLevelThread.comments[0]?.id ?? '',
			'DELETE',
			owner.headers
		)
		expect(await deleteTopLevel.json()).toEqual({ threadDeleted: true })

		const listed = await listThreads(owner.headers)
		expect(await listed.json()).toMatchObject({
			threads: [{ id: inlineThread.id }],
		})
		const pathFiltered = await listThreads(owner.headers, 'src/index.ts')
		expect(await pathFiltered.json()).toMatchObject({
			threads: [{ id: inlineThread.id, kind: 'inline' }],
		})
	})

	test('persists and lists range and single-line anchors', async () => {
		const rangeResponse = await createThread(
			{
				body: 'Range',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 5,
					endLine: 7,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'range end',
				},
			},
			owner.headers
		)
		expect(rangeResponse.status).toBe(200)
		const range = (await rangeResponse.json()) as ThreadResponseBody
		expect(range.anchor).toEqual({
			path: 'src/index.ts',
			side: 'right',
			startLine: 5,
			endLine: 7,
			anchorSha: HEAD_SHA,
			baseSha: BASE_SHA,
			headSha: HEAD_SHA,
			lineExcerpt: 'range end',
		})
		expect(
			await db.query.pullRequestThreads.findFirst({
				where: (threads, { eq }) => eq(threads.id, range.id),
			})
		).toMatchObject({ startLine: 5, line: 7 })

		const singleResponse = await createThread(
			{
				body: 'Single',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 9,
					endLine: 9,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'single line',
				},
			},
			owner.headers
		)
		expect(singleResponse.status).toBe(200)
		const single = (await singleResponse.json()) as ThreadResponseBody
		expect(
			await db.query.pullRequestThreads.findFirst({
				where: (threads, { eq }) => eq(threads.id, single.id),
			})
		).toMatchObject({ startLine: null, line: 9 })

		expect(await (await listThreads(owner.headers)).json()).toMatchObject({
			threads: [
				{ id: range.id, anchor: { startLine: 5, endLine: 7 } },
				{ id: single.id, anchor: { startLine: 9, endLine: 9 } },
			],
		})
	})

	test('rejects creating a thread against a stale head', async () => {
		compareRepositoryRefs.mockResolvedValue(comparison(MOVED_HEAD_SHA))

		const response = await createThread(
			{
				body: 'Stale',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 7,
					endLine: 7,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const value = 1',
				},
			},
			owner.headers
		)

		expect(response.status).toBe(409)
		expect(await response.json()).toMatchObject({
			code: 'CONFLICT',
			message: PULL_REQUEST_STALE_COMPARISON_MESSAGE,
		})
		expect(await db.query.pullRequestThreads.findFirst()).toBeUndefined()
	})

	test('marks inline threads outdated after the comparison head moves', async () => {
		await createThread(
			{
				body: 'Inline',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 7,
					endLine: 7,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const value = 1',
				},
			},
			owner.headers
		)
		compareRepositoryRefs.mockResolvedValue(comparison(MOVED_HEAD_SHA))

		expect(await (await listThreads(owner.headers)).json()).toMatchObject({
			threads: [{ outdated: true }],
			comparison: { baseSha: BASE_SHA, headSha: MOVED_HEAD_SHA },
		})
	})

	// Moving the target moves the base every inline anchor was measured against,
	// so the threads on it go outdated exactly as they do when the head moves.
	// They still block the merge: the unresolved count ignores outdatedness.
	test('marks inline threads outdated after the target branch moves', async () => {
		await createThread(
			{
				body: 'Inline',
				anchor: {
					path: 'src/index.ts',
					side: 'right',
					startLine: 7,
					endLine: 7,
					anchorSha: HEAD_SHA,
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					lineExcerpt: 'const value = 1',
				},
			},
			owner.headers
		)

		const retargeted = await request(
			'http://localhost/repositories/owner/notes/pulls/1/retarget',
			'POST',
			owner.headers,
			{ targetBranch: 'release' }
		)
		expect(retargeted.status).toBe(200)

		compareRepositoryRefs.mockResolvedValue(comparison(HEAD_SHA, RELEASE_SHA))

		expect(await (await listThreads(owner.headers)).json()).toMatchObject({
			threads: [{ outdated: true }],
			comparison: { baseSha: RELEASE_SHA, headSha: HEAD_SHA },
		})
	})

	test('requires authentication for mutations', async () => {
		expect((await createThread({ body: 'Anonymous' })).status).toBe(401)
	})

	test('allows a read collaborator to create and reply', async () => {
		const reader = await createIntegrationUser('reader')
		const repository = await db.query.repositories.findFirst()
		if (!repository) throw new Error('Repository missing')
		await db.insert(repositoryCollaborators).values({
			repositoryId: repository.id,
			userId: reader.id,
			role: 'read',
		})

		expect(await (await listThreads(reader.headers)).json()).toMatchObject({
			viewer: {
				canComment: true,
				canResolveAnyThread: false,
				canDeleteAnyComment: false,
			},
		})
		const created = await createThread(
			{ body: 'Reader comment' },
			reader.headers
		)
		expect(created.status).toBe(200)
		const thread = (await created.json()) as ThreadResponseBody
		expect(
			(
				await threadAction(thread.id, 'comments', 'POST', reader.headers, {
					body: 'Reader reply',
				})
			).status
		).toBe(200)
	})

	test('masks private threads from a non-collaborator', async () => {
		const outsider = await createIntegrationUser('outsider')

		expect((await listThreads(outsider.headers)).status).toBe(404)
		expect(
			(await createThread({ body: 'Hidden' }, outsider.headers)).status
		).toBe(404)
	})

	test('filters other users pending comments from thread responses', async () => {
		const reviewer = await createIntegrationUser('reviewer')
		const created = await createThread({ body: 'Published' }, owner.headers)
		const thread = (await created.json()) as ThreadResponseBody
		const [pullRequest] = await db.select().from(pullRequests)
		if (!pullRequest) throw new Error('Failed to find pull request')
		const [review] = await db
			.insert(pullRequestReviews)
			.values({
				pullRequestId: pullRequest.id,
				reviewerUserId: reviewer.id,
				headSha: HEAD_SHA,
			})
			.returning()
		if (!review) throw new Error('Failed to create pending review')
		await db.insert(pullRequestComments).values({
			threadId: thread.id as never,
			authorUserId: reviewer.id,
			body: 'Pending',
			state: 'pending',
			reviewId: review.id,
		})

		const response = (await (await listThreads(owner.headers)).json()) as {
			threads: ThreadResponseBody[]
		}
		expect(response.threads[0]?.comments).toEqual([
			expect.objectContaining({ body: 'Published' }),
		])
	})

	function comparison(headSha: string, baseSha = BASE_SHA) {
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

	async function createRepository(
		visibility: 'public' | 'private',
		headers: Headers
	) {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			headers,
			{
				name: 'Notes',
				slug: 'notes',
				visibility,
			}
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)
	}

	function listThreads(headers?: Headers, path?: string) {
		const search = path ? `?${new URLSearchParams({ path })}` : ''
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/1/threads${search}`,
			{ headers }
		)
	}

	function createThread(body: object, headers?: Headers) {
		return request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			'POST',
			headers,
			body
		)
	}

	function threadAction(
		threadId: string,
		action: 'comments' | 'resolve' | 'unresolve',
		method: 'POST',
		headers: Headers,
		body?: object
	) {
		return request(
			`http://localhost/repositories/owner/notes/pulls/1/threads/${threadId}/${action}`,
			method,
			headers,
			body
		)
	}

	function commentAction(
		commentId: string,
		method: 'DELETE' | 'PATCH',
		headers: Headers,
		body?: object
	) {
		return request(
			`http://localhost/repositories/owner/notes/pulls/1/comments/${commentId}`,
			method,
			headers,
			body
		)
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
		await db.delete(pullRequestEvents)
		await db.delete(pullRequestComments)
		await db.delete(pullRequestThreads)
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

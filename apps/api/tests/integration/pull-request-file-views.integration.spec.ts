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
import { and, count, eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	pullRequestEvents,
	pullRequestFileViews,
	pullRequests,
	repositories,
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
class PullRequestFileViewsIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
}

describe('Pull request file views integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let currentHeadSha: string
	let owner: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		moduleRef = await Test.createTestingModule({
			imports: [PullRequestFileViewsIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
					})
				),
				listRepositoryRefs: vi.fn(() =>
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
				compareRepositoryRefs: vi.fn(() =>
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

	test('lists empty state and handles true and false idempotently', async () => {
		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: [],
		})

		for (const viewed of [true, true]) {
			const response = await setFileViewed(
				{ expectedHeadSha: HEAD_SHA, path: 'src/index.ts', viewed },
				owner.headers
			)
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({
				headSha: HEAD_SHA,
				path: 'src/index.ts',
				viewed,
			})
		}

		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: ['src/index.ts'],
		})
		await setFileViewed(
			{ expectedHeadSha: HEAD_SHA, path: 'src/other.ts', viewed: true },
			owner.headers
		)

		for (const viewed of [false, false]) {
			const response = await setFileViewed(
				{ expectedHeadSha: HEAD_SHA, path: 'src/index.ts', viewed },
				owner.headers
			)
			expect(response.status).toBe(200)
			expect(await response.json()).toEqual({
				headSha: HEAD_SHA,
				path: 'src/index.ts',
				viewed,
			})
		}

		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: ['src/other.ts'],
		})
	})

	test('filters rows by current head', async () => {
		const pullRequest = await getPullRequestRow()
		await db.insert(pullRequestFileViews).values([
			{
				userId: owner.id,
				pullRequestId: pullRequest.id,
				headSha: HEAD_SHA,
				path: 'src/current.ts',
			},
			{
				userId: owner.id,
				pullRequestId: pullRequest.id,
				headSha: MOVED_HEAD_SHA,
				path: 'src/other-head.ts',
			},
		])

		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: ['src/current.ts'],
		})
	})

	test('rejects a stale expected head', async () => {
		currentHeadSha = MOVED_HEAD_SHA

		const getResponse = await listViewedFiles(owner.headers, HEAD_SHA)
		const putResponse = await setFileViewed(
			{ expectedHeadSha: HEAD_SHA, path: 'src/index.ts', viewed: true },
			owner.headers
		)

		expect(getResponse.status).toBe(409)
		expect(await getResponse.json()).toMatchObject({
			code: 'CONFLICT',
			status: 409,
		})
		expect(putResponse.status).toBe(409)
		expect(await putResponse.json()).toMatchObject({
			code: 'CONFLICT',
			status: 409,
		})
		expect(await countViewedPaths()).toBe(0)
	})

	test('requires authentication', async () => {
		expect((await listViewedFiles()).status).toBe(401)
		expect(
			(
				await setFileViewed({
					expectedHeadSha: HEAD_SHA,
					path: 'src/index.ts',
					viewed: true,
				})
			).status
		).toBe(401)
	})

	test('masks a private repository from a non-reader', async () => {
		const outsider = await createIntegrationUser('outsider')

		expect((await listViewedFiles(outsider.headers)).status).toBe(404)
		expect(
			(
				await setFileViewed(
					{
						expectedHeadSha: HEAD_SHA,
						path: 'src/index.ts',
						viewed: true,
					},
					outsider.headers
				)
			).status
		).toBe(404)
	})

	test('round-trips whitespace paths exactly', async () => {
		const path = ' src/index.ts '

		expect(
			(
				await setFileViewed(
					{ expectedHeadSha: HEAD_SHA, path, viewed: true },
					owner.headers
				)
			).status
		).toBe(200)
		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: [path],
		})
	})

	test('round-trips 2048 UTF-8 bytes and rejects larger paths', async () => {
		const maximumPath = 'ą'.repeat(1024)
		const oversizedPath = 'ą'.repeat(1025)

		expect(
			(
				await setFileViewed(
					{ expectedHeadSha: HEAD_SHA, path: maximumPath, viewed: true },
					owner.headers
				)
			).status
		).toBe(200)
		expect(
			(
				await setFileViewed(
					{ expectedHeadSha: HEAD_SHA, path: oversizedPath, viewed: true },
					owner.headers
				)
			).status
		).toBe(400)
		expect(await (await listViewedFiles(owner.headers)).json()).toEqual({
			headSha: HEAD_SHA,
			paths: [maximumPath],
		})
	})

	test('returns conflict after 1000 distinct paths are viewed', async () => {
		const pullRequest = await getPullRequestRow()
		await db.insert(pullRequestFileViews).values(
			Array.from({ length: 1000 }, (_unused, index) => ({
				userId: owner.id,
				pullRequestId: pullRequest.id,
				headSha: HEAD_SHA,
				path: `src/file-${index}.ts`,
			}))
		)

		const existingResponse = await setFileViewed(
			{ expectedHeadSha: HEAD_SHA, path: 'src/file-0.ts', viewed: true },
			owner.headers
		)
		const overflowResponse = await setFileViewed(
			{ expectedHeadSha: HEAD_SHA, path: 'src/overflow.ts', viewed: true },
			owner.headers
		)

		expect(existingResponse.status).toBe(200)
		expect(overflowResponse.status).toBe(409)
		expect(await overflowResponse.json()).toMatchObject({
			code: 'CONFLICT',
			status: 409,
		})
		expect(await countViewedPaths()).toBe(1000)
	})

	test('serializes concurrent inserts at the cap', async () => {
		const pullRequest = await getPullRequestRow()
		await db.insert(pullRequestFileViews).values(
			Array.from({ length: 999 }, (_unused, index) => ({
				userId: owner.id,
				pullRequestId: pullRequest.id,
				headSha: HEAD_SHA,
				path: `src/file-${index}.ts`,
			}))
		)

		const responses = await Promise.all([
			setFileViewed(
				{ expectedHeadSha: HEAD_SHA, path: 'src/first.ts', viewed: true },
				owner.headers
			),
			setFileViewed(
				{ expectedHeadSha: HEAD_SHA, path: 'src/second.ts', viewed: true },
				owner.headers
			),
		])

		expect(responses.map(response => response.status).sort()).toEqual([
			200, 409,
		])
		expect(await countViewedPaths()).toBe(1000)
	})

	function listViewedFiles(headers?: Headers, expectedHeadSha = HEAD_SHA) {
		const search = new URLSearchParams({ expectedHeadSha })

		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/1/files/viewed?${search}`,
			{ headers }
		)
	}

	function setFileViewed(body: object, headers?: Headers) {
		return request(
			'http://localhost/repositories/owner/notes/pulls/1/files/viewed',
			'PUT',
			headers,
			body
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

		return { id: createdUser.id, headers }
	}

	async function createRepository(headers: Headers) {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			headers,
			{ name: 'Notes', slug: 'notes', visibility: 'private' }
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)
	}

	async function getPullRequestRow() {
		const pullRequest = await db.query.pullRequests.findFirst()
		if (!pullRequest) throw new Error('Pull request missing')

		return pullRequest
	}

	async function countViewedPaths() {
		const pullRequest = await getPullRequestRow()
		const [result] = await db
			.select({ total: count() })
			.from(pullRequestFileViews)
			.where(
				and(
					eq(pullRequestFileViews.userId, owner.id),
					eq(pullRequestFileViews.pullRequestId, pullRequest.id),
					eq(pullRequestFileViews.headSha, HEAD_SHA)
				)
			)

		return result?.total ?? 0
	}

	function request(
		url: string,
		method: 'POST' | 'PUT',
		headers: Headers | undefined,
		body: object
	) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(url, {
			method,
			headers: requestHeaders,
			body: JSON.stringify(body),
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(pullRequestFileViews)
		await db.delete(pullRequestEvents)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})

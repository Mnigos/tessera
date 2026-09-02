import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageModule } from '@config/git-storage'
import { QueueModule } from '@config/queue'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { GitHubImportModule } from '@modules/github-import'
import { GitHubImportQueue } from '@modules/github-import/infrastructure/github-import.queue'
import { GitHubOctokitClient } from '@modules/github-import/infrastructure/github-octokit.client'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubImportRepositoryVisibility } from '@repo/contracts'
import { eq, type RepositoryImportId } from '@repo/db'
import { db } from '@repo/db/client'
import { account, repositoryImports, session, user } from '@repo/db/schema'
import type { RepositorySlug, UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		QueueModule,
		RPCModule,
		AuthModule,
		GitHubImportModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
class GitHubImportIntegrationTestModule {}

interface GitHubImportRepositoriesResponseBody {
	repositories: {
		githubId: string
		ownerLogin: string
		name: string
		fullName: string
		visibility: GitHubImportRepositoryVisibility
		defaultBranch: string
		pushedAt?: string
		githubUrl: string
	}[]
	nextPage?: number
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
	data?: unknown
}

interface CreateIntegrationUserOptions {
	username: string
	email: string
	name?: string
}

interface IntegrationSession {
	headers: Headers
	userId: UserId
}

const publicRepository = {
	id: 123,
	owner: {
		login: 'marta',
	},
	name: 'tessera',
	full_name: 'marta/tessera',
	visibility: 'public' as const,
	default_branch: 'main',
	pushed_at: '2026-05-10T12:34:56Z',
	html_url: 'https://github.com/marta/tessera',
	private: false,
}
const privateRepository = {
	...publicRepository,
	id: 456,
	name: 'private-notes',
	full_name: 'marta/private-notes',
	visibility: 'private' as const,
	pushed_at: null,
	html_url: 'https://github.com/marta/private-notes',
	private: true,
}

function githubRepositoryResponse(id: number, fullName: string) {
	const [ownerLogin = 'marta', name = 'repository'] = fullName.split('/')

	return {
		...publicRepository,
		id,
		owner: { login: ownerLogin },
		name,
		full_name: fullName,
		html_url: `https://github.com/${fullName}`,
	}
}

function fullGitHubRepositoryPage(page: number, matchingFullName?: string) {
	return Array.from({ length: 50 }, (_, index) =>
		githubRepositoryResponse(
			page * 100 + index,
			index === 0 && matchingFullName
				? matchingFullName
				: `marta/repository-${page}-${index}`
		)
	)
}

describe('GitHub import integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let listForAuthenticatedUser: ReturnType<typeof vi.fn>
	let githubOctokitClient: GitHubOctokitClient
	let enqueueRepositoryImport: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		listForAuthenticatedUser = vi.fn()
		githubOctokitClient = new GitHubOctokitClient()
		vi.spyOn(githubOctokitClient, 'createForUser').mockReturnValue({
			rest: { repos: { listForAuthenticatedUser } },
		} as never)
		enqueueRepositoryImport = vi.fn().mockResolvedValue(undefined)
		moduleRef = await Test.createTestingModule({
			imports: [GitHubImportIntegrationTestModule],
		})
			.overrideProvider(GitHubOctokitClient)
			.useValue(githubOctokitClient)
			.overrideProvider(GitHubImportQueue)
			.useValue({ enqueueRepositoryImport })
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		listForAuthenticatedUser.mockReset()
		enqueueRepositoryImport.mockClear()
		enqueueRepositoryImport.mockResolvedValue(undefined)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('rejects unauthenticated repository list requests', async () => {
		const response = await listGitHubImportRepositories()
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('lists accessible GitHub repositories including private repositories', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		mockGitHubRepositories([publicRepository, privateRepository])

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as GitHubImportRepositoriesResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toEqual([
			{
				githubId: '123',
				ownerLogin: 'marta',
				name: 'tessera',
				fullName: 'marta/tessera',
				visibility: 'public',
				defaultBranch: 'main',
				pushedAt: '2026-05-10T12:34:56.000Z',
				githubUrl: 'https://github.com/marta/tessera',
			},
			{
				githubId: '456',
				ownerLogin: 'marta',
				name: 'private-notes',
				fullName: 'marta/private-notes',
				visibility: 'private',
				defaultBranch: 'main',
				githubUrl: 'https://github.com/marta/private-notes',
			},
		])
		expect(listForAuthenticatedUser).toHaveBeenCalledOnce()
		expect(listForAuthenticatedUser).toHaveBeenCalledWith({
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 50,
			page: 1,
		})
	})

	test('passes page and search through four GitHub pages', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		const pages = new Map([
			[2, fullGitHubRepositoryPage(2, 'marta/Notes')],
			[3, fullGitHubRepositoryPage(3)],
			[4, fullGitHubRepositoryPage(4, 'ludus/meeting-notes')],
			[5, fullGitHubRepositoryPage(5)],
		])
		listForAuthenticatedUser.mockImplementation(({ page }: { page: number }) =>
			Promise.resolve({
				data: pages.get(page) ?? [],
				headers: {
					link: '<https://api.github.com/user/repos?page=6>; rel="next"',
				},
			})
		)

		const response = await listGitHubImportRepositories(
			integrationSession.headers,
			'page=2&search=Notes'
		)
		const body = (await response.json()) as GitHubImportRepositoriesResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories.map(repository => repository.fullName)).toEqual([
			'marta/Notes',
			'ludus/meeting-notes',
		])
		expect(body.nextPage).toBe(6)
		expect(listForAuthenticatedUser).toHaveBeenCalledTimes(4)
		expect(
			listForAuthenticatedUser.mock.calls.map(([input]) => input.page)
		).toEqual([2, 3, 4, 5])
		for (const [index, page] of [2, 3, 4, 5].entries())
			expect(listForAuthenticatedUser).toHaveBeenNthCalledWith(index + 1, {
				visibility: 'all',
				sort: 'pushed',
				direction: 'desc',
				per_page: 50,
				page,
			})
	})

	test.each([
		'   ',
		'x'.repeat(201),
	])('rejects invalid search input %j', async search => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})

		const response = await listGitHubImportRepositories(
			integrationSession.headers,
			new URLSearchParams({ search }).toString()
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body).toMatchObject({
			defined: false,
			code: 'BAD_REQUEST',
			status: 400,
			message: 'Input validation failed',
			data: { issues: expect.any(Array) },
		})
		expect(Object.keys(body).sort()).toEqual([
			'code',
			'data',
			'defined',
			'message',
			'status',
		])
		expect(listForAuthenticatedUser).not.toHaveBeenCalled()
	})

	test('returns an empty list when GitHub returns no repositories', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		mockGitHubRepositories([])

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as GitHubImportRepositoriesResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toEqual([])
	})

	test('lists repositories when the stored GitHub scope is blank', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
			scope: '',
		})
		mockGitHubRepositories([])

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as GitHubImportRepositoriesResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toEqual([])
	})

	test('rejects authenticated users without a GitHub account token', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'github import authentication required',
		})
		expect(listForAuthenticatedUser).not.toHaveBeenCalled()
	})

	test('maps GitHub 401 failures to an auth error response', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		listForAuthenticatedUser.mockRejectedValue({ status: 401 })

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'github import authentication required',
		})
	})

	test('maps GitHub 403 failures to a permission error response', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		listForAuthenticatedUser.mockRejectedValue({ status: 403 })

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(403)
		expect(body).toMatchObject({
			code: 'FORBIDDEN',
			message: 'github import access denied',
		})
	})

	test('retries a failed import, resetting it to pending and re-enqueueing', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		const importId = await createRepositoryImport({
			userId: integrationSession.userId,
			status: 'failed',
		})

		const response = await retryGitHubImport(
			importId,
			integrationSession.headers
		)
		const body = (await response.json()) as { import: { status: string } }

		expect(response.status).toBe(200)
		expect(body.import.status).toBe('pending')

		const persisted = await findRepositoryImport(importId)
		expect(persisted?.status).toBe('pending')
		expect(persisted?.failureReason).toBeNull()
		expect(persisted?.startedAt).toBeNull()
		expect(persisted?.completedAt).toBeNull()
		expect(enqueueRepositoryImport).toHaveBeenCalledWith(importId)
	})

	test('rejects retry of an import that is not failed', async () => {
		const integrationSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createGitHubAccount({
			userId: integrationSession.userId,
			accessToken: 'github-token',
		})
		const importId = await createRepositoryImport({
			userId: integrationSession.userId,
			status: 'pending',
		})

		const response = await retryGitHubImport(
			importId,
			integrationSession.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body).toMatchObject({
			code: 'CONFLICT',
			message: 'github repository import is not retryable',
		})
		expect(enqueueRepositoryImport).not.toHaveBeenCalled()
	})

	test('rejects retry by a user who does not own the import', async () => {
		const ownerSession = await createIntegrationSession({
			username: 'marta',
			email: 'marta@example.com',
		})
		const otherSession = await createIntegrationSession({
			username: 'olek',
			email: 'olek@example.com',
		})
		await createGitHubAccount({
			userId: otherSession.userId,
			accessToken: 'github-token',
		})
		const importId = await createRepositoryImport({
			userId: ownerSession.userId,
			status: 'failed',
		})

		const response = await retryGitHubImport(importId, otherSession.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'github repository import not found',
		})
		expect(enqueueRepositoryImport).not.toHaveBeenCalled()

		const persisted = await findRepositoryImport(importId)
		expect(persisted?.status).toBe('failed')
	})

	async function createIntegrationSession({
		email,
		name,
		username,
	}: CreateIntegrationUserOptions): Promise<IntegrationSession> {
		const token = crypto.randomUUID()
		const createdUsers = await db
			.insert(user)
			.values({
				name: name ?? username,
				email,
				emailVerified: true,
				username,
			})
			.returning({ id: user.id })
		const createdUser = createdUsers[0]

		if (!createdUser) throw new Error('Failed to create integration user')

		await db.insert(session).values({
			token,
			userId: createdUser.id,
			expiresAt: new Date(Date.now() + 86_400_000),
		})

		const headers = new Headers()
		headers.set(
			'cookie',
			`better-auth.session_token=${token}.${await makeSignature(
				token,
				'test-auth-secret'
			)}`
		)

		return { headers, userId: createdUser.id }
	}

	async function createGitHubAccount({
		accessToken,
		scope = 'repo',
		userId,
	}: {
		accessToken: string
		scope?: string | null
		userId: UserId
	}) {
		await db.insert(account).values({
			accountId: crypto.randomUUID(),
			providerId: 'github',
			userId,
			accessToken,
			scope,
		})
	}

	async function createRepositoryImport({
		status,
		userId,
	}: {
		status: 'pending' | 'running' | 'succeeded' | 'failed'
		userId: UserId
	}): Promise<RepositoryImportId> {
		const isFailed = status === 'failed'
		const [created] = await db
			.insert(repositoryImports)
			.values({
				ownerUserId: userId,
				provider: 'github',
				targetName: publicRepository.name,
				targetSlug: publicRepository.name as RepositorySlug,
				sourceGithubId: BigInt(publicRepository.id),
				sourceOwnerLogin: publicRepository.owner.login,
				sourceName: publicRepository.name,
				sourceFullName: publicRepository.full_name,
				sourceVisibility: publicRepository.visibility,
				sourceDefaultBranch: publicRepository.default_branch,
				sourceGithubUrl: publicRepository.html_url,
				status,
				failureReason: isFailed ? 'storage unavailable' : null,
				startedAt: isFailed ? new Date() : null,
				completedAt: isFailed ? new Date() : null,
			})
			.returning({ id: repositoryImports.id })

		if (!created) throw new Error('Failed to create repository import')

		return created.id
	}

	async function findRepositoryImport(importId: RepositoryImportId) {
		return await db.query.repositoryImports.findFirst({
			where: eq(repositoryImports.id, importId),
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(repositoryImports)
		await db.delete(account)
		await db.delete(session)
		await db.delete(user)
	}

	function listGitHubImportRepositories(headers?: Headers, query?: string) {
		const search = query ? `?${query}` : ''

		return adapter.hono.request(
			`http://localhost/github-import/repositories${search}`,
			{
				headers,
			}
		)
	}

	function retryGitHubImport(importId: RepositoryImportId, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/github-import/imports/${importId}/retry`,
			{
				method: 'POST',
				headers,
			}
		)
	}

	function mockGitHubRepositories(
		repositories: (typeof publicRepository | typeof privateRepository)[]
	) {
		listForAuthenticatedUser.mockResolvedValue({
			data: repositories,
			headers: {},
		})
	}
})

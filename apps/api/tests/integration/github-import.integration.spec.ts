import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { GitHubImportModule } from '@modules/github-import'
import { GitHubOctokitClient } from '@modules/github-import/infrastructure/github-octokit.client'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubImportRepositoryVisibility } from '@repo/contracts'
import { db } from '@repo/db/client'
import { account, session, user } from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
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
		githubId: number
		ownerLogin: string
		name: string
		fullName: string
		visibility: GitHubImportRepositoryVisibility
		defaultBranch: string
		pushedAt?: string
		githubUrl: string
	}[]
}

interface ErrorResponseBody {
	defined: true
	code: string
	message: string
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

describe('GitHub import integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let paginate: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		paginate = vi.fn()
		moduleRef = await Test.createTestingModule({
			imports: [GitHubImportIntegrationTestModule],
		})
			.overrideProvider(GitHubOctokitClient)
			.useValue({
				createForUser: vi.fn(() => ({
					paginate,
					rest: {
						repos: {
							listForAuthenticatedUser: vi.fn(),
						},
					},
				})),
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		paginate.mockReset()
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
		paginate.mockResolvedValue([publicRepository, privateRepository])

		const response = await listGitHubImportRepositories(
			integrationSession.headers
		)
		const body = (await response.json()) as GitHubImportRepositoriesResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toEqual([
			{
				githubId: 123,
				ownerLogin: 'marta',
				name: 'tessera',
				fullName: 'marta/tessera',
				visibility: 'public',
				defaultBranch: 'main',
				pushedAt: '2026-05-10T12:34:56.000Z',
				githubUrl: 'https://github.com/marta/tessera',
			},
			{
				githubId: 456,
				ownerLogin: 'marta',
				name: 'private-notes',
				fullName: 'marta/private-notes',
				visibility: 'private',
				defaultBranch: 'main',
				githubUrl: 'https://github.com/marta/private-notes',
			},
		])
		expect(paginate).toHaveBeenCalledWith(expect.any(Function), {
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 100,
		})
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
		paginate.mockResolvedValue([])

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
		expect(paginate).not.toHaveBeenCalled()
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
		paginate.mockRejectedValue({ status: 401 })

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
		paginate.mockRejectedValue({ status: 403 })

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
		userId,
	}: {
		accessToken: string
		userId: UserId
	}) {
		await db.insert(account).values({
			accountId: crypto.randomUUID(),
			providerId: 'github',
			userId,
			accessToken,
			scope: 'repo',
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(account)
		await db.delete(session)
		await db.delete(user)
	}

	function listGitHubImportRepositories(headers?: Headers) {
		return adapter.hono.request('http://localhost/github-import/repositories', {
			headers,
		})
	}
})

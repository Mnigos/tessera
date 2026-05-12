import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import { repositories, session, user } from '@repo/db/schema'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ExternalServiceError } from '~/shared/errors'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		RPCModule,
		AuthModule,
		RepositoriesModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
class RepositoriesIntegrationTestModule {}

interface RepositoryResponseBody {
	repository: {
		id: string
		slug: string
		name: string
		visibility: 'public' | 'private'
		description?: string
		defaultBranch: string
		storagePath?: string
		createdAt: string
		updatedAt: string
	}
	owner: {
		username: string
	}
}

interface RepositoryListResponseBody {
	repositories: RepositoryResponseBody[]
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

describe('Repositories integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let gitStorageCreateRepository: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		gitStorageCreateRepository = vi.fn(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)

		moduleRef = await Test.createTestingModule({
			imports: [RepositoriesIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({ createRepository: gitStorageCreateRepository })
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageCreateRepository.mockImplementation(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('rejects unauthenticated create requests', async () => {
		const response = await createRepository({ name: 'Notes' })
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('creates an authenticated repository with a generated slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository(
			{ name: ' Tessera Notes ' },
			headers
		)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'tessera-notes',
				name: 'Tessera Notes',
				visibility: 'private',
				defaultBranch: 'main',
			},
			owner: {
				username: 'marta',
			},
		})
		expect(body.repository.id).toEqual(expect.any(String))
		expect(body.repository.storagePath).toBe(
			`/var/lib/tessera/repositories/${body.repository.id}.git`
		)
		expect(Date.parse(body.repository.createdAt)).not.toBeNaN()
		expect(gitStorageCreateRepository).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
		})
	})

	test('creates a repository with a normalized custom slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository(
			{
				name: 'Roadmap',
				slug: '  Release Roadmap!!  ',
				description: 'Launch notes',
				visibility: 'public',
			},
			headers
		)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body.repository).toMatchObject({
			slug: 'release-roadmap',
			name: 'Roadmap',
			description: 'Launch notes',
			visibility: 'public',
			storagePath: `/var/lib/tessera/repositories/${body.repository.id}.git`,
		})
	})

	test('cleans up metadata when git storage creation fails', async () => {
		gitStorageCreateRepository.mockRejectedValueOnce(
			new ExternalServiceError('git storage')
		)
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository({ name: 'Notes' }, headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(502)
		expect(body).toMatchObject({
			code: 'BAD_GATEWAY',
			message: 'git storage request failed',
		})
		expect(await db.query.repositories.findMany()).toHaveLength(0)
	})

	test('rejects duplicate slugs for the same user', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const response = await createRepository(
			{ name: 'More Notes', slug: 'notes' },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body).toMatchObject({
			code: 'CONFLICT',
			message: 'repository slug already exists',
		})
	})

	test('allows the same slug for different users', async () => {
		const martaHeaders = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const renHeaders = await createIntegrationSessionHeaders({
			username: 'ren',
			email: 'ren@example.com',
		})

		expect(
			(await createRepository({ name: 'Notes', slug: 'notes' }, martaHeaders))
				.status
		).toBe(200)
		expect(
			(await createRepository({ name: 'Notes', slug: 'notes' }, renHeaders))
				.status
		).toBe(200)
	})

	test('lists repositories for the current username', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes' }, headers)
		await createRepository({ name: 'Roadmap' }, headers)

		const response = await listRepositories('marta', headers)
		const body = (await response.json()) as RepositoryListResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toHaveLength(2)
		expect(body.repositories.map(item => item.repository.slug).sort()).toEqual([
			'notes',
			'roadmap',
		])
		expect(
			body.repositories.every(item => item.owner.username === 'marta')
		).toBeTruthy()
	})

	test('hides another username when listing repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await listRepositories('ren', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('gets an owned repository by owner username and slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes' }, headers)

		const response = await getRepository('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				name: 'Notes',
			},
			owner: {
				username: 'marta',
			},
		})
	})

	test('hides another username when getting repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes' }, headers)

		const response = await getRepository('ren', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('returns not found for an unknown owned repository', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await getRepository('marta', 'missing', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	async function createIntegrationSessionHeaders(
		options: CreateIntegrationUserOptions
	) {
		const token = crypto.randomUUID()
		const createdUsers = await db
			.insert(user)
			.values({
				name: options.name ?? options.username,
				email: options.email,
				emailVerified: true,
				username: options.username,
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

		return headers
	}

	async function resetIntegrationDatabase() {
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(user)
	}

	function createRepository(input: object, headers?: Headers) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request('http://localhost/repositories', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify(input),
		})
	}

	function listRepositories(username: string, headers: Headers) {
		return adapter.hono.request(`http://localhost/repositories/${username}`, {
			headers,
		})
	}

	function getRepository(username: string, slug: string, headers: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}`,
			{ headers }
		)
	}
})

import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
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
		GitStorageModule,
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

interface RepositoryTreeEntryResponseBody {
	name: string
	objectId: string
	kind: 'directory' | 'file' | 'submodule' | 'symlink' | 'unknown'
	sizeBytes: number
	path: string
	mode: string
}

interface RepositoryBrowserSummaryResponseBody extends RepositoryResponseBody {
	isEmpty: boolean
	defaultBranch: string
	selectedRef?: RepositoryRefResponseBody
	branches: RepositoryBranchRefResponseBody[]
	tags: RepositoryTagRefResponseBody[]
	rootEntries: RepositoryTreeEntryResponseBody[]
	readme?: {
		filename: string
		objectId: string
		content: string
		isTruncated: boolean
	}
}

interface RepositoryBranchRefResponseBody {
	type: 'branch'
	name: string
	qualifiedName: string
	target: string
}

interface RepositoryTagRefResponseBody {
	type: 'tag'
	name: string
	qualifiedName: string
	target: string
}

type RepositoryRefResponseBody =
	| RepositoryBranchRefResponseBody
	| RepositoryTagRefResponseBody

interface RepositoryTreeResponseBody extends RepositoryResponseBody {
	ref: string
	commitId: string
	path: string
	entries: RepositoryTreeEntryResponseBody[]
}

type RepositoryBlobPreviewResponseBody =
	| {
			type: 'text'
			content: string
	  }
	| {
			type: 'binary'
	  }
	| {
			type: 'tooLarge'
			previewLimitBytes: number
	  }

interface RepositoryBlobResponseBody extends RepositoryResponseBody {
	ref: string
	path: string
	name: string
	objectId: string
	sizeBytes: number
	preview: RepositoryBlobPreviewResponseBody
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
	let gitStorageGetRepositoryBrowserSummary: ReturnType<typeof vi.fn>
	let gitStorageListRepositoryRefs: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryTree: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryBlob: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryRawBlob: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		gitStorageCreateRepository = vi.fn(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)
		gitStorageGetRepositoryBrowserSummary = vi.fn().mockResolvedValue({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		gitStorageListRepositoryRefs = vi.fn().mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
		})
		gitStorageGetRepositoryTree = vi.fn().mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		gitStorageGetRepositoryBlob = vi.fn().mockResolvedValue({
			objectId: 'blob123',
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
			sizeBytes: 17,
		})
		gitStorageGetRepositoryRawBlob = vi.fn().mockResolvedValue({
			objectId: 'blob123',
			content: new Uint8Array([0, 1, 2, 255]),
			sizeBytes: 4,
		})

		moduleRef = await Test.createTestingModule({
			imports: [RepositoriesIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: gitStorageCreateRepository,
				getRepositoryBrowserSummary: gitStorageGetRepositoryBrowserSummary,
				listRepositoryRefs: gitStorageListRepositoryRefs,
				getRepositoryTree: gitStorageGetRepositoryTree,
				getRepositoryBlob: gitStorageGetRepositoryBlob,
				getRepositoryRawBlob: gitStorageGetRepositoryRawBlob,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageCreateRepository.mockReset()
		gitStorageGetRepositoryBrowserSummary.mockReset()
		gitStorageListRepositoryRefs.mockReset()
		gitStorageGetRepositoryTree.mockReset()
		gitStorageGetRepositoryBlob.mockReset()
		gitStorageGetRepositoryRawBlob.mockReset()
		gitStorageCreateRepository.mockImplementation(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)
		gitStorageGetRepositoryBrowserSummary.mockResolvedValue({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
		})
		gitStorageGetRepositoryTree.mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		gitStorageGetRepositoryBlob.mockResolvedValue({
			objectId: 'blob123',
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
			sizeBytes: 17,
		})
		gitStorageGetRepositoryRawBlob.mockResolvedValue({
			objectId: 'blob123',
			content: new Uint8Array([0, 1, 2, 255]),
			sizeBytes: 4,
		})
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
		expect(Date.parse(body.repository.createdAt)).not.toBeNaN()
		expect(gitStorageCreateRepository).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
		})
	})

	test('rejects invalid create input before creating git storage', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository({ name: '' }, headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
		expect(gitStorageCreateRepository).not.toHaveBeenCalled()
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

	test('rejects unauthenticated repository list requests', async () => {
		const response = await listRepositories('marta')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
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
		await createRepository(
			{ name: 'Notes', description: 'Project notes', visibility: 'public' },
			headers
		)

		const response = await getRepository('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toEqual({
			repository: {
				id: expect.any(String),
				slug: 'notes',
				name: 'Notes',
				visibility: 'public',
				description: 'Project notes',
				defaultBranch: 'main',
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
			},
			owner: {
				username: 'marta',
			},
		})
		expect(Date.parse(body.repository.createdAt)).not.toBeNaN()
		expect(Date.parse(body.repository.updatedAt)).not.toBeNaN()
	})

	test('rejects unauthenticated repository detail requests', async () => {
		const response = await getRepository('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
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

	test('returns public repository browser summary for anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getBrowserSummary('marta', 'notes')
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				name: 'Notes',
				visibility: 'public',
				defaultBranch: 'main',
			},
			owner: {
				username: 'marta',
			},
			isEmpty: false,
			defaultBranch: 'main',
			selectedRef: {
				type: 'branch',
				name: 'main',
				qualifiedName: 'refs/heads/main',
				target: 'commit123',
			},
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		expect(gitStorageGetRepositoryBrowserSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				defaultBranch: 'main',
			})
		)
		expect(gitStorageListRepositoryRefs).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
			storagePath: `/var/lib/tessera/repositories/${body.repository.id}.git`,
		})
	})

	test('returns private repository browser summary for the owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await getBrowserSummary('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				visibility: 'private',
			},
			owner: {
				username: 'marta',
			},
		})
	})

	test('hides private repository browser summary from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageGetRepositoryBrowserSummary.mockClear()

		const response = await getBrowserSummary('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageGetRepositoryBrowserSummary).not.toHaveBeenCalled()
	})

	test('rejects invalid repository browser inputs before git storage reads', async () => {
		const response = await getBrowserSummary('marta', 'bad_slug')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
		expect(gitStorageGetRepositoryBrowserSummary).not.toHaveBeenCalled()
	})

	test('returns repository tree entries for public repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getTree('marta', 'notes', 'main', 'src')
		const body = (await response.json()) as RepositoryTreeResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
			},
			owner: {
				username: 'marta',
			},
			ref: 'main',
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				ref: 'main',
				path: 'src',
			})
		)
	})

	test('returns blob previews for public repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getBlob('marta', 'notes', 'main', 'src/index.ts')
		const body = (await response.json()) as RepositoryBlobResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
			},
			owner: {
				username: 'marta',
			},
			ref: 'main',
			path: 'src/index.ts',
			name: 'index.ts',
			objectId: 'blob123',
			sizeBytes: 17,
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
		})
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'main',
				path: 'src',
			})
		)
		expect(gitStorageGetRepositoryBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				objectId: 'blob123',
			})
		)
	})

	test('returns raw blob bytes from the HTTP raw route', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getRawBlob('marta', 'notes', 'main', 'src/index.ts')

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 255])
		)
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'main',
				path: 'src',
			})
		)
		expect(gitStorageGetRepositoryRawBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				objectId: 'blob123',
			})
		)
	})

	test('returns private raw blob bytes to the repository owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await getRawBlob(
			'marta',
			'notes',
			'main',
			'src/index.ts',
			headers
		)

		expect(response.status).toBe(200)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 255])
		)
		expect(gitStorageGetRepositoryRawBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				objectId: 'blob123',
			})
		)
	})

	test('hides private raw blob bytes from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageGetRepositoryTree.mockClear()
		gitStorageGetRepositoryRawBlob.mockClear()

		const response = await getRawBlob('marta', 'notes', 'main', 'src/index.ts')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageGetRepositoryTree).not.toHaveBeenCalled()
		expect(gitStorageGetRepositoryRawBlob).not.toHaveBeenCalled()
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

	function listRepositories(username: string, headers?: Headers) {
		return adapter.hono.request(`http://localhost/repositories/${username}`, {
			headers,
		})
	}

	function getRepository(username: string, slug: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}`,
			{ headers }
		)
	}

	function getBrowserSummary(
		username: string,
		slug: string,
		headers?: Headers
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/browser`,
			{ headers }
		)
	}

	function getTree(
		username: string,
		slug: string,
		ref: string,
		path?: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams()
		if (path) searchParams.set('path', path)
		const query = searchParams.size ? `?${searchParams.toString()}` : ''

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/tree/${ref}${query}`,
			{ headers }
		)
	}

	function getBlob(
		username: string,
		slug: string,
		ref: string,
		path: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams({ path })

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/blob/${ref}?${searchParams.toString()}`,
			{ headers }
		)
	}

	function getRawBlob(
		username: string,
		slug: string,
		ref: string,
		path: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams({ path })

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/raw/${ref}?${searchParams.toString()}`,
			{ headers }
		)
	}
})

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
	pullRequestEvents,
	pullRequests,
	repositories,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type { RepositoryId } from '@repo/domain'
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
		RPCModule,
		AuthModule,
		RepositoriesModule,
		PullRequestsModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class PullRequestsIntegrationTestModule {}

interface PullRequestResponseBody {
	id: string
	repositoryId: string
	number: number
	authorUserId: string
	authorUsername: string
	sourceBranch: string
	targetBranch: string
	openingBaseSha: string
	openingHeadSha: string
	title: string
	body: string
	state: 'open' | 'closed' | 'merged'
	createdAt: string
	updatedAt: string
	closedAt?: string
	mergedAt?: string
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

describe('Pull requests integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let gitStorageCreateRepository: ReturnType<typeof vi.fn>
	let gitStorageListRepositoryRefs: ReturnType<typeof vi.fn>
	let gitStorageCompareRepositoryRefs: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryFileDiff: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryBlob: ReturnType<typeof vi.fn>
	let gitStorageMergeRepositoryRefs: ReturnType<typeof vi.fn>

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
		gitStorageListRepositoryRefs = vi.fn()
		gitStorageCompareRepositoryRefs = vi.fn()
		gitStorageGetRepositoryFileDiff = vi.fn()
		gitStorageGetRepositoryBlob = vi.fn()
		gitStorageMergeRepositoryRefs = vi.fn()

		moduleRef = await Test.createTestingModule({
			imports: [PullRequestsIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: gitStorageCreateRepository,
				listRepositoryRefs: gitStorageListRepositoryRefs,
				compareRepositoryRefs: gitStorageCompareRepositoryRefs,
				getRepositoryFileDiff: gitStorageGetRepositoryFileDiff,
				getRepositoryBlob: gitStorageGetRepositoryBlob,
				mergeRepositoryRefs: gitStorageMergeRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageCreateRepository.mockClear()
		gitStorageListRepositoryRefs.mockReset()
		gitStorageCompareRepositoryRefs.mockReset()
		gitStorageGetRepositoryFileDiff.mockReset()
		gitStorageGetRepositoryBlob.mockReset()
		gitStorageMergeRepositoryRefs.mockReset()
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'base-sha',
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'head-sha',
				},
				{
					type: 'branch',
					name: 'feature-two',
					qualifiedName: 'refs/heads/feature-two',
					target: 'head-two-sha',
				},
			],
			tags: [],
		})
	})

	test('compares, diffs, and merges a pull request through the HTTP API', async () => {
		const baseSha = 'a'.repeat(40)
		const headSha = 'b'.repeat(40)
		const mergeCommitSha = 'c'.repeat(40)
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: baseSha,
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: headSha,
				},
			],
			tags: [],
		})
		gitStorageCompareRepositoryRefs.mockResolvedValue({
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			commits: [
				{
					sha: headSha,
					shortSha: headSha.slice(0, 7),
					summary: 'Add feature',
					author: {
						name: 'Marta',
						email: 'marta@example.com',
						date: '2026-07-11T10:00:00.000Z',
					},
				},
			],
			files: [
				{
					status: 'modified',
					oldPath: 'src/index.ts',
					newPath: 'src/index.ts',
					baseBlobId: 'base-blob',
					headBlobId: 'head-blob',
					additions: 1,
					deletions: 1,
					isBinary: false,
				},
			],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		})
		gitStorageGetRepositoryFileDiff.mockResolvedValue({
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			file: {
				status: 'modified',
				oldPath: 'src/index.ts',
				newPath: 'src/index.ts',
				baseBlobId: 'base-blob',
				headBlobId: 'head-blob',
				additions: 1,
				deletions: 1,
				isBinary: false,
			},
			hunks: [
				{
					header: '@@ -1 +1 @@',
					lines: [
						{ kind: 'deletion', content: 'const oldValue = 1', oldLine: 1 },
						{ kind: 'addition', content: 'const newValue = 2', newLine: 1 },
					],
				},
			],
			isTruncated: false,
			patchLimitBytes: 2_097_152,
		})
		gitStorageGetRepositoryBlob.mockImplementation(({ objectId }) =>
			Promise.resolve({
				objectId,
				sizeBytes: 18,
				preview: {
					type: 'text',
					content:
						objectId === 'base-blob'
							? 'const oldValue = 1'
							: 'const newValue = 2',
				},
			})
		)
		gitStorageMergeRepositoryRefs.mockResolvedValue(mergeCommitSha)
		const headers = await createUserAndRepository({ visibility: 'public' })
		await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
			},
			headers
		)

		const comparisonResponse = await getPullRequestComparison(
			'marta',
			'notes',
			1
		)
		expect(comparisonResponse.status).toBe(200)
		expect(await comparisonResponse.json()).toMatchObject({
			baseSha,
			headSha,
			commits: [{ summary: 'Add feature' }],
			files: [{ newPath: 'src/index.ts' }],
		})

		const diffResponse = await getPullRequestFileDiff(
			'marta',
			'notes',
			1,
			'src/index.ts',
			baseSha,
			headSha
		)
		expect(diffResponse.status).toBe(200)
		expect(await diffResponse.json()).toMatchObject({
			language: 'typescript',
			hunks: [{ lines: [{ old: { line: 1 } }, { new: { line: 1 } }] }],
		})

		const mergeResponse = await mergePullRequest(
			'marta',
			'notes',
			1,
			{ expectedBaseSha: baseSha, expectedHeadSha: headSha },
			headers
		)
		expect(mergeResponse.status).toBe(200)
		expect(await mergeResponse.json()).toMatchObject({
			state: 'merged',
			mergeCommitSha,
		})
		expect(gitStorageMergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBaseSha: baseSha,
				expectedHeadSha: headSha,
			})
		)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('requires authentication to create pull requests', async () => {
		const response = await createPullRequest('marta', 'notes', {
			sourceBranch: 'feature',
			targetBranch: 'main',
			title: 'Add feature',
		})
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body.code).toBe('UNAUTHORIZED')
	})

	test('creates, lists, and gets a public pull request with an opened event', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		const createResponse = await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
				body: 'Details',
			},
			headers
		)
		const created = (await createResponse.json()) as PullRequestResponseBody

		expect(createResponse.status).toBe(200)
		expect(created).toMatchObject({
			number: 1,
			openingBaseSha: 'base-sha',
			openingHeadSha: 'head-sha',
			state: 'open',
		})

		const listResponse = await listPullRequests('marta', 'notes')
		expect(listResponse.status).toBe(200)
		expect(await listResponse.json()).toMatchObject({
			pullRequests: [{ number: 1, title: 'Add feature' }],
		})

		const getResponse = await getPullRequest('marta', 'notes', 1)
		expect(getResponse.status).toBe(200)
		expect(await getResponse.json()).toMatchObject({
			pullRequest: { number: 1 },
			events: [{ type: 'opened' }],
		})
	})

	test('allocates repository-scoped numbers safely for concurrent creates', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		const responses = await Promise.all([
			createPullRequest(
				'marta',
				'notes',
				{
					sourceBranch: 'feature',
					targetBranch: 'main',
					title: 'First',
				},
				headers
			),
			createPullRequest(
				'marta',
				'notes',
				{
					sourceBranch: 'feature-two',
					targetBranch: 'main',
					title: 'Second',
				},
				headers
			),
		])
		const pullRequestNumbers = await Promise.all(
			responses.map(async response => {
				expect(response.status).toBe(200)

				return ((await response.json()) as PullRequestResponseBody).number
			})
		)

		expect(pullRequestNumbers.toSorted()).toEqual([1, 2])
	})

	test('prevents multiple open pull requests for the same branch pair', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		const input = {
			sourceBranch: 'feature',
			targetBranch: 'main',
			title: 'Add feature',
		}
		await createPullRequest('marta', 'notes', input, headers)

		const response = await createPullRequest('marta', 'notes', input, headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.code).toBe('CONFLICT')
	})

	test.each([
		{
			name: 'identical branches',
			sourceBranch: 'main',
			targetBranch: 'main',
		},
		{
			name: 'missing source branch',
			sourceBranch: 'missing',
			targetBranch: 'main',
		},
	])('rejects $name', async ({ sourceBranch, targetBranch }) => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		const response = await createPullRequest(
			'marta',
			'notes',
			{ sourceBranch, targetBranch, title: 'Invalid' },
			headers
		)

		expect(response.status).toBe(400)
	})

	test('rejects a source branch with no revision changes', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'same',
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'same',
				},
			],
			tags: [],
		})

		const response = await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'No changes',
			},
			headers
		)

		expect(response.status).toBe(400)
	})

	test('hides private pull requests from anonymous readers', async () => {
		const headers = await createUserAndRepository({ visibility: 'private' })
		await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Private',
			},
			headers
		)

		expect((await listPullRequests('marta', 'notes')).status).toBe(404)
		expect((await getPullRequest('marta', 'notes', 1)).status).toBe(404)
	})

	test('requires repository write permission for mutations', async () => {
		const ownerHeaders = await createUserAndRepository({ visibility: 'public' })
		await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Owned',
			},
			ownerHeaders
		)
		const otherHeaders = await createIntegrationSessionHeaders({
			username: 'jan',
			email: 'jan@example.com',
		})

		const response = await editPullRequest(
			'marta',
			'notes',
			1,
			{ title: 'Forbidden' },
			otherHeaders
		)

		expect(response.status).toBe(403)
	})

	test('blocks mutations while GitHub is the read-only source of truth', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		const repository = await getRepositoryRow()
		await db.insert(repositoryExternalSources).values({
			repositoryId: repository.id,
			provider: 'github',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
		})

		const response = await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Blocked',
			},
			headers
		)

		expect(response.status).toBe(403)
	})

	test('edits, closes, and reopens while recording lifecycle events', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Initial',
			},
			headers
		)

		const editResponse = await editPullRequest(
			'marta',
			'notes',
			1,
			{ title: 'Updated', body: 'Body' },
			headers
		)
		expect(editResponse.status).toBe(200)
		expect(await editResponse.json()).toMatchObject({ title: 'Updated' })

		const closeResponse = await transitionPullRequest(
			'marta',
			'notes',
			1,
			'close',
			headers
		)
		expect(closeResponse.status).toBe(200)
		expect(await closeResponse.json()).toMatchObject({ state: 'closed' })

		const reopenResponse = await transitionPullRequest(
			'marta',
			'notes',
			1,
			'reopen',
			headers
		)
		expect(reopenResponse.status).toBe(200)
		expect(await reopenResponse.json()).toMatchObject({ state: 'open' })

		const getResponse = await getPullRequest('marta', 'notes', 1)
		expect(await getResponse.json()).toMatchObject({
			events: [
				{ type: 'opened' },
				{ type: 'edited' },
				{ type: 'closed' },
				{ type: 'reopened' },
			],
		})
	})

	async function createUserAndRepository({
		visibility,
	}: {
		visibility: 'public' | 'private'
	}) {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository(
			{ name: 'Notes', slug: 'notes', visibility },
			headers
		)

		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		return headers
	}

	async function createIntegrationSessionHeaders({
		email,
		username,
	}: {
		email: string
		username: string
	}) {
		const token = crypto.randomUUID()
		const [createdUser] = await db
			.insert(user)
			.values({ name: username, email, emailVerified: true, username })
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
			`better-auth.session_token=${token}.${await makeSignature(
				token,
				'test-auth-secret'
			)}`
		)

		return headers
	}

	async function getRepositoryRow(): Promise<{ id: RepositoryId }> {
		const repository = await db.query.repositories.findFirst()

		if (!repository) throw new Error('Failed to find repository')

		return repository
	}

	async function resetIntegrationDatabase() {
		await db.delete(pullRequestEvents)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}

	function createRepository(input: object, headers: Headers) {
		return request('http://localhost/repositories', 'POST', headers, input)
	}

	function createPullRequest(
		username: string,
		slug: string,
		input: object,
		headers?: Headers
	) {
		return request(
			`http://localhost/repositories/${username}/${slug}/pulls`,
			'POST',
			headers,
			input
		)
	}

	function listPullRequests(username: string, slug: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/pulls`,
			{ headers }
		)
	}

	function getPullRequest(
		username: string,
		slug: string,
		number: number,
		headers?: Headers
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}`,
			{ headers }
		)
	}

	function getPullRequestComparison(
		username: string,
		slug: string,
		number: number
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/comparison`
		)
	}

	function getPullRequestFileDiff(
		username: string,
		slug: string,
		number: number,
		path: string,
		expectedBaseSha: string,
		expectedHeadSha: string
	) {
		const searchParams = new URLSearchParams({
			path,
			expectedBaseSha,
			expectedHeadSha,
		})

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/files?${searchParams}`
		)
	}

	function editPullRequest(
		username: string,
		slug: string,
		number: number,
		input: object,
		headers?: Headers
	) {
		return request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}`,
			'PATCH',
			headers,
			input
		)
	}

	function transitionPullRequest(
		username: string,
		slug: string,
		number: number,
		action: 'close' | 'reopen',
		headers?: Headers
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/${action}`,
			{ method: 'POST', headers }
		)
	}

	function mergePullRequest(
		username: string,
		slug: string,
		number: number,
		input: object,
		headers: Headers
	) {
		return request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/merge`,
			'POST',
			headers,
			input
		)
	}

	function request(
		url: string,
		method: 'PATCH' | 'POST',
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
})

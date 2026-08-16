import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import { PullRequestsModule } from '@modules/pull-requests'
import { MergeQueueRepository } from '@modules/pull-requests/infrastructure/merge-queue.repository'
import { PullRequestsRepository } from '@modules/pull-requests/infrastructure/pull-requests.repository'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	gitHubActors,
	gitHubPullRequestMappings,
	mergeQueueEntries,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequests,
	repositories,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type { MergeQueueState, RepositoryId } from '@repo/domain'
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
	let gitStorageCheckRepositoryMergeability: ReturnType<typeof vi.fn>
	let gitStorageFindMergeReceipt: ReturnType<typeof vi.fn>
	let pullRequestsRepository: PullRequestsRepository
	let mergeQueueRepository: MergeQueueRepository

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
		gitStorageCheckRepositoryMergeability = vi.fn()
		gitStorageFindMergeReceipt = vi.fn()

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
				checkRepositoryMergeability: gitStorageCheckRepositoryMergeability,
				findMergeReceipt: gitStorageFindMergeReceipt,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
		pullRequestsRepository = moduleRef.get(PullRequestsRepository, {
			strict: false,
		})
		mergeQueueRepository = moduleRef.get(MergeQueueRepository, {
			strict: false,
		})
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageCreateRepository.mockClear()
		gitStorageListRepositoryRefs.mockReset()
		gitStorageCompareRepositoryRefs.mockReset()
		gitStorageGetRepositoryFileDiff.mockReset()
		gitStorageGetRepositoryBlob.mockReset()
		gitStorageMergeRepositoryRefs.mockReset()
		gitStorageCheckRepositoryMergeability.mockReset()
		gitStorageFindMergeReceipt.mockReset()
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
		gitStorageCheckRepositoryMergeability.mockResolvedValue({
			baseSha,
			headSha,
			mergeBaseSha: baseSha,
			mergeable: true,
			conflictPaths: [],
			conflictPathsTruncated: false,
			conflictPathLimit: 100,
			// A git storage that answers for merge methods answers for all four;
			// anything less is refused as an answer that never reached them.
			strategyAvailability: [
				{ strategy: 'merge_commit', available: true },
				{ strategy: 'squash', available: true },
				{ strategy: 'rebase', available: true },
				{ strategy: 'fast_forward', available: true },
			],
		})
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
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha },
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

	test('keeps GitHub numbers in provider mappings and allocates local route numbers', async () => {
		const headers = await createUserAndRepository({ visibility: 'public' })
		await createPullRequest(
			'marta',
			'notes',
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Native pull request',
			},
			headers
		)
		const repository = await getRepositoryRow()
		const [actor] = await db
			.insert(gitHubActors)
			.values({
				externalNodeId: 'github-user-node',
				externalNumericId: 7n,
				login: 'marta',
				type: 'user',
			})
			.returning({ id: gitHubActors.id })
		if (!actor) throw new Error('Failed to create GitHub actor')
		const synchronizedPullRequest: GitHubSyncPullRequest = {
			nodeId: 'github-pull-request-node',
			numericId: 101n,
			number: 1,
			htmlUrl: 'https://github.com/tessera-org/notes/pull/1',
			title: 'Synchronized pull request',
			body: '',
			state: 'open',
			draft: false,
			author: {
				nodeId: 'github-user-node',
				numericId: 7n,
				login: 'marta',
				type: 'user',
			},
			sourceBranch: 'github-feature',
			targetBranch: 'main',
			headRepositoryNodeId: 'repository-node',
			baseRepositoryNodeId: 'repository-node',
			headSha: 'github-head-sha',
			baseSha: 'github-base-sha',
			createdAt: new Date('2026-07-28T10:00:00Z'),
			updatedAt: new Date('2026-07-28T11:00:00Z'),
		}

		await pullRequestsRepository.reconcileGitHubPullRequest({
			repositoryId: repository.id,
			pullRequest: synchronizedPullRequest,
			authorActorId: actor.id,
			pendingEvents: [],
		})

		expect(
			await db.query.pullRequests.findMany({
				orderBy: (table, { asc }) => [asc(table.number)],
				columns: { provider: true, number: true },
			})
		).toEqual([
			{ provider: 'tessera', number: 1 },
			{ provider: 'github', number: 2 },
		])
		expect(
			await db.query.gitHubPullRequestMappings.findFirst({
				columns: { externalNumber: true },
			})
		).toEqual({ externalNumber: 1 })
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

	// Only the target moves, and every consequence of moving it is a read-time
	// one: the row keeps the SHAs it was opened against, and the comparison is
	// resolved from the live branches on the next request.
	describe('retargeting', () => {
		const branches = [
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
				name: 'release',
				qualifiedName: 'refs/heads/release',
				target: 'release-sha',
			},
		]

		async function createRetargetablePullRequest() {
			const headers = await createUserAndRepository({ visibility: 'public' })
			gitStorageListRepositoryRefs.mockResolvedValue({ branches, tags: [] })
			await createPullRequest(
				'marta',
				'notes',
				{ sourceBranch: 'feature', targetBranch: 'main', title: 'Initial' },
				headers
			)

			return headers
		}

		test('moves the target and records both branches on the timeline', async () => {
			const headers = await createRetargetablePullRequest()

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({
				targetBranch: 'release',
				sourceBranch: 'feature',
				openingBaseSha: 'base-sha',
				openingHeadSha: 'head-sha',
			})

			const getResponse = await getPullRequest('marta', 'notes', 1)
			expect(await getResponse.json()).toMatchObject({
				events: [
					{ type: 'opened' },
					{
						type: 'retargeted',
						payload: { fromBranch: 'main', toBranch: 'release' },
					},
				],
			})
		})

		test('accepts the target it already has without recording an event', async () => {
			const headers = await createRetargetablePullRequest()

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'main' },
				headers
			)

			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({ targetBranch: 'main' })

			const getResponse = await getPullRequest('marta', 'notes', 1)
			expect(await getResponse.json()).toMatchObject({
				events: [{ type: 'opened' }],
			})
		})

		test.each([
			{ name: 'a branch that does not exist', targetBranch: 'missing' },
			{ name: 'the pull request’s own source branch', targetBranch: 'feature' },
		])('rejects $name', async ({ targetBranch }) => {
			const headers = await createRetargetablePullRequest()

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch },
				headers
			)

			expect(response.status).toBe(400)
		})

		test('rejects a target with no revision difference from the source', async () => {
			const headers = await createRetargetablePullRequest()
			gitStorageListRepositoryRefs.mockResolvedValue({
				branches: [
					...branches.slice(0, 2),
					{
						type: 'branch',
						name: 'release',
						qualifiedName: 'refs/heads/release',
						target: 'head-sha',
					},
				],
				tags: [],
			})

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(400)
		})

		test('refuses to move an open pair onto one that already exists', async () => {
			const headers = await createRetargetablePullRequest()
			await createPullRequest(
				'marta',
				'notes',
				{
					sourceBranch: 'feature',
					targetBranch: 'release',
					title: 'Already there',
				},
				headers
			)

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)
			const body = (await response.json()) as ErrorResponseBody

			expect(response.status).toBe(409)
			expect(body.code).toBe('CONFLICT')
		})

		// The open-pair index is scoped to Tessera-provided pull requests, so a
		// synchronized GitHub row on the same pair is not what it excludes. This
		// records that contract rather than widening it.
		test('moves onto a pair a synchronized GitHub pull request already holds', async () => {
			const headers = await createRetargetablePullRequest()
			const repository = await getRepositoryRow()
			const author = await db.query.user.findFirst()

			if (!author) throw new Error('Failed to find the repository owner')

			await db.insert(pullRequests).values({
				repositoryId: repository.id,
				provider: 'github',
				number: 2,
				authorUserId: author.id,
				sourceBranch: 'feature',
				targetBranch: 'release',
				openingBaseSha: 'release-sha',
				openingHeadSha: 'head-sha',
				title: 'Synchronized',
			})

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(200)
		})

		test('refuses to retarget a closed pull request', async () => {
			const headers = await createRetargetablePullRequest()
			await transitionPullRequest('marta', 'notes', 1, 'close', headers)

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(409)
		})

		test('refuses a retarget from someone without write access', async () => {
			await createRetargetablePullRequest()
			const otherHeaders = await createIntegrationSessionHeaders({
				username: 'jan',
				email: 'jan@example.com',
			})

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				otherHeaders
			)

			expect(response.status).toBe(403)
		})

		async function getPullRequestRow() {
			const row = await db.query.pullRequests.findFirst()

			if (!row) throw new Error('Failed to find the pull request')

			return row
		}

		async function getOwnerRow() {
			const owner = await db.query.user.findFirst()

			if (!owner) throw new Error('Failed to find the repository owner')

			return owner
		}

		async function getEventTypes() {
			const response = await getPullRequest('marta', 'notes', 1)
			const body = (await response.json()) as {
				events: { type: string }[]
			}

			return body.events.map(event => event.type)
		}

		async function queueEntryFor(state: MergeQueueState) {
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()

			await db.insert(mergeQueueEntries).values({
				repositoryId: pullRequest.repositoryId,
				pullRequestId: pullRequest.id,
				position: 1,
				state,
				// The state's own timestamp is part of what makes the row valid.
				mergingAt: state === 'merging' ? new Date() : null,
				strategy: 'merge_commit',
				enqueuedByUserId: owner.id,
				enqueuedBaseSha: 'base-sha',
				enqueuedHeadSha: 'head-sha',
			})
		}

		async function mergeIntentStartedAt(startedAt: Date) {
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()

			await db.insert(pullRequestMergeIntents).values({
				pullRequestId: pullRequest.id,
				attemptId: crypto.randomUUID(),
				actorUserId: owner.id,
				strategy: 'merge_commit',
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
				commitMessage: 'Merge pull request #1: Initial',
				startedAt,
			})
		}

		// A queued entry is a statement about the branches it was queued for. The
		// refusal has to be actionable, and a `merging` entry cannot be left.
		test.each([
			['queued', 'Leave the merge queue before changing the target branch.'],
			[
				'merging',
				'This pull request is being merged right now. Change the target once that merge has settled.',
			],
		] as const)('refuses a retarget while an entry is %s', async (state, message) => {
			const headers = await createRetargetablePullRequest()
			await queueEntryFor(state)

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)
			const body = (await response.json()) as ErrorResponseBody

			expect(response.status).toBe(409)
			expect(body.message).toBe(message)
			expect(await getEventTypes()).toEqual(['opened'])
			expect((await getPullRequestRow()).targetBranch).toBe('main')
		})

		// The intent is young enough that recovery will not touch it, so it reaches
		// the transaction and is refused there.
		test('refuses a retarget while a merge intent is held', async () => {
			const headers = await createRetargetablePullRequest()
			await mergeIntentStartedAt(new Date())

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)
			const body = (await response.json()) as ErrorResponseBody

			expect(response.status).toBe(409)
			expect(body.message).toBe(
				'A merge is in progress for this pull request. Try again once it settles.'
			)
			expect(await getEventTypes()).toEqual(['opened'])
			expect((await getPullRequestRow()).targetBranch).toBe('main')
		})

		// An abandoned attempt already merged this pull request onto the target it
		// is being moved away from. Recovery records that, and the retarget is
		// refused for the merged pull request it turns out to be.
		test('records an abandoned merge and refuses the retarget', async () => {
			const headers = await createRetargetablePullRequest()
			await mergeIntentStartedAt(new Date(Date.now() - 10 * 60 * 1000))
			gitStorageFindMergeReceipt.mockResolvedValue('c'.repeat(40))

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(409)

			const pullRequest = await getPullRequestRow()

			expect(pullRequest.state).toBe('merged')
			expect(pullRequest.targetBranch).toBe('main')
			expect(await getEventTypes()).toEqual(['opened', 'merged'])
		})

		test('refuses a retarget while another merge holds the repository', async () => {
			const headers = await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			await mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId: pullRequest.repositoryId,
				owner: 'another-attempt',
				ttlMs: 120_000,
			})

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)
			const body = (await response.json()) as ErrorResponseBody

			expect(response.status).toBe(409)
			expect(body.message).toBe(
				'Merge work is in progress on this repository. Try again once it settles.'
			)
			expect(await getEventTypes()).toEqual(['opened'])
		})

		test('refuses to retarget a merged pull request', async () => {
			const headers = await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()
			await db
				.update(pullRequests)
				.set({
					state: 'merged',
					mergedAt: new Date(),
					closedAt: new Date(),
					mergeCommitSha: 'c'.repeat(40),
					mergeActorUserId: owner.id,
				})
				.where(eq(pullRequests.id, pullRequest.id))

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(409)
			expect(await getEventTypes()).toEqual(['opened'])
		})

		test('records no event when the move collides with an existing open pair', async () => {
			const headers = await createRetargetablePullRequest()
			await createPullRequest(
				'marta',
				'notes',
				{
					sourceBranch: 'feature',
					targetBranch: 'release',
					title: 'Already there',
				},
				headers
			)

			await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(await getEventTypes()).toEqual(['opened'])
		})

		// The lease is re-proved inside the transaction. A caller whose hold aged
		// out and was taken by somebody else writes nothing, however long ago it
		// believed it had the repository.
		test('writes nothing for a caller whose lease was taken by another', async () => {
			await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()
			await mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId: pullRequest.repositoryId,
				owner: 'the-new-holder',
				ttlMs: 120_000,
			})

			expect(
				await pullRequestsRepository.retarget({
					repositoryId: pullRequest.repositoryId,
					pullRequestId: pullRequest.id,
					actorUserId: owner.id,
					expectedTargetBranch: 'main',
					leaseOwner: 'the-stale-holder',
					targetBranch: 'release',
				})
			).toEqual({ status: 'lease_lost' })
			expect((await getPullRequestRow()).targetBranch).toBe('main')
			expect(await getEventTypes()).toEqual(['opened'])
		})

		// Two identical requests both read `main`; the second gets the lease after
		// the first committed. The state it asked for holds, so it is a retry that
		// succeeded, and it writes no second event.
		test('treats a second identical move as already done', async () => {
			await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()
			const write = {
				repositoryId: pullRequest.repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: owner.id,
				expectedTargetBranch: 'main',
				leaseOwner: 'the-holder',
				targetBranch: 'release',
			}
			await mergeQueueRepository.acquireRepositoryMergeLease({
				repositoryId: pullRequest.repositoryId,
				owner: 'the-holder',
				ttlMs: 120_000,
			})

			expect(await pullRequestsRepository.retarget(write)).toMatchObject({
				status: 'retargeted',
			})
			expect(await pullRequestsRepository.retarget(write)).toMatchObject({
				status: 'unchanged',
			})
			expect(await getEventTypes()).toEqual(['opened', 'retargeted'])
		})

		test('records one move when two identical requests race', async () => {
			const headers = await createRetargetablePullRequest()

			const responses = await Promise.all([
				retargetPullRequest(
					'marta',
					'notes',
					1,
					{ targetBranch: 'release' },
					headers
				),
				retargetPullRequest(
					'marta',
					'notes',
					1,
					{ targetBranch: 'release' },
					headers
				),
			])

			// Whichever order they land in, one of them moved the branch and neither
			// left the pull request somewhere nobody asked for.
			expect(responses.some(response => response.status === 200)).toBeTruthy()
			expect(
				responses.every(response => [200, 409].includes(response.status))
			).toBeTruthy()
			expect((await getPullRequestRow()).targetBranch).toBe('release')
			expect(await getEventTypes()).toEqual(['opened', 'retargeted'])
		})

		// The race the branch-pair recheck exists for: the join resolved its refs
		// against `main`, a retarget committed, and the entry must not be written
		// against a target the pull request no longer has.
		test('refuses a queue join whose branches moved before it committed', async () => {
			const headers = await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()

			await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(
				await mergeQueueRepository.enqueueEntry({
					repositoryId: pullRequest.repositoryId,
					pullRequestId: pullRequest.id,
					enqueuedByUserId: owner.id,
					enqueuedBaseSha: 'base-sha',
					enqueuedHeadSha: 'head-sha',
					expectedSourceBranch: 'feature',
					expectedTargetBranch: 'main',
					selection: { strategy: 'merge_commit' },
				})
			).toEqual({ status: 'branches_changed' })
			expect(await db.query.mergeQueueEntries.findFirst()).toBeUndefined()
			expect(await getEventTypes()).toEqual(['opened', 'retargeted'])
		})

		// Run against each other rather than in sequence: whichever wins, an entry
		// may only exist alongside the branches it was snapshotted for.
		test('never queues a snapshot of a target the pull request has left', async () => {
			const headers = await createRetargetablePullRequest()
			const pullRequest = await getPullRequestRow()
			const owner = await getOwnerRow()

			await Promise.all([
				retargetPullRequest(
					'marta',
					'notes',
					1,
					{ targetBranch: 'release' },
					headers
				),
				mergeQueueRepository.enqueueEntry({
					repositoryId: pullRequest.repositoryId,
					pullRequestId: pullRequest.id,
					enqueuedByUserId: owner.id,
					enqueuedBaseSha: 'base-sha',
					enqueuedHeadSha: 'head-sha',
					expectedSourceBranch: 'feature',
					expectedTargetBranch: 'main',
					selection: { strategy: 'merge_commit' },
				}),
			])

			const entry = await db.query.mergeQueueEntries.findFirst()

			if (entry) expect((await getPullRequestRow()).targetBranch).toBe('main')
			else expect((await getPullRequestRow()).targetBranch).toBe('release')
		})

		// Retargeting a mirror is forwarded to GitHub as the caller, so a caller
		// with no linked GitHub account is asked to reconnect rather than refused
		// on authority.
		test('asks an unlinked caller to reconnect GitHub instead of retargeting a mirrored pull request', async () => {
			const headers = await createRetargetablePullRequest()
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

			const response = await retargetPullRequest(
				'marta',
				'notes',
				1,
				{ targetBranch: 'release' },
				headers
			)

			expect(response.status).toBe(401)
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
		await db.delete(gitHubPullRequestMappings)
		await db.delete(gitHubActors)
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

	function retargetPullRequest(
		username: string,
		slug: string,
		number: number,
		input: object,
		headers?: Headers
	) {
		return request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/retarget`,
			'POST',
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
		// The merge method is an explicit choice the contract requires, exactly as
		// the web client always sends one. A body that names none merges the way
		// every merge did before strategies existed.
		return request(
			`http://localhost/repositories/${username}/${slug}/pulls/${number}/merge`,
			'POST',
			headers,
			{ strategy: 'merge_commit', ...input }
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

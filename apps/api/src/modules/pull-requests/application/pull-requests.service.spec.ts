import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import { mockUserId } from '~/shared/test-utils'
import {
	PullRequestAlreadyOpenError,
	PullRequestInvalidBranchesError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { PullRequestsService } from './pull-requests.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const createdAt = new Date('2026-07-11T00:00:00Z')
const repositoryContext = {
	repositoryId,
	storagePath: '/var/lib/tessera/repositories/repo.git',
}
const repositoryAccessContext = {
	...repositoryContext,
	viewerRole: 'write' as const,
	tesseraWritesAllowed: true,
}
const pullRequest: PullRequest = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'base-sha',
	openingHeadSha: 'head-sha',
	title: 'Add feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeActorUserId: null,
	createdAt,
	updatedAt: createdAt,
	closedAt: null,
	mergedAt: null,
}
const event: PullRequestEvent = {
	id: '00000000-0000-4000-8000-000000000045' as PullRequestEventId,
	pullRequestId,
	provider: 'tessera',
	actorUserId: mockUserId,
	type: 'opened',
	payload: null,
	createdAt,
}
const repositoryInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
}

describe(PullRequestsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestsService
	let repository: PullRequestsRepository
	let repositoriesService: RepositoriesService
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestsService,
				{
					provide: PullRequestsRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						find: vi.fn(),
						listEvents: vi.fn(),
						edit: vi.fn(),
						close: vi.fn(),
						reopen: vi.fn(),
						claimMerge: vi.fn(),
						completeMerge: vi.fn(),
						releaseMerge: vi.fn(),
					},
				},
				{
					provide: RepositoriesService,
					useValue: {
						getReadableRepositoryContext: vi.fn(),
						getWritableRepositoryContext: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						listRepositoryRefs: vi.fn(),
						compareRepositoryRefs: vi.fn(),
						getRepositoryFileDiff: vi.fn(),
						getRepositoryBlob: vi.fn(),
						mergeRepositoryRefs: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestsService)
		repository = moduleRef.get(PullRequestsRepository)
		repositoriesService = moduleRef.get(RepositoriesService)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue(repositoryAccessContext)
		vi.spyOn(
			repositoriesService,
			'getWritableRepositoryContext'
		).mockResolvedValue(repositoryAccessContext)
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
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
			],
			tags: [],
		})
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a pull request from current branch heads', async () => {
		const createSpy = vi
			.spyOn(repository, 'create')
			.mockResolvedValue(pullRequest)

		expect(
			await service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
				body: undefined,
			})
		).toEqual(expect.objectContaining({ number: 1, state: 'open' }))
		expect(createSpy).toHaveBeenCalledWith({
			repositoryId,
			authorUserId: mockUserId,
			sourceBranch: 'feature',
			targetBranch: 'main',
			openingBaseSha: 'base-sha',
			openingHeadSha: 'head-sha',
			title: 'Add feature',
			body: '',
		})
	})

	test('rejects missing branches', async () => {
		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'missing',
				targetBranch: 'main',
				title: 'Invalid',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestInvalidBranchesError)
	})

	test('rejects branches resolving to the same revision', async () => {
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
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

		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'No changes',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestNoChangesError)
	})

	test('maps open branch pair uniqueness to a conflict', async () => {
		vi.spyOn(repository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'pull_requests_open_branch_pair_unique',
		})

		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Duplicate',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestAlreadyOpenError)
	})

	test('lists readable repository pull requests by state', async () => {
		const listSpy = vi
			.spyOn(repository, 'list')
			.mockResolvedValue([pullRequest])

		const result = await service.list(undefined, {
			...repositoryInput,
			state: 'open',
		})

		expect(result.pullRequests).toHaveLength(1)
		expect(result.viewerRole).toBe('write')
		expect(listSpy).toHaveBeenCalledWith({ repositoryId, state: 'open' })
	})

	test('gets a pull request with lifecycle events', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'listEvents').mockResolvedValue([event])

		expect(
			await service.get(undefined, { ...repositoryInput, number: 1 })
		).toEqual({
			pullRequest: expect.objectContaining({ id: pullRequestId }),
			events: [{ ...event, actorUsername: 'marta', payload: undefined }],
			viewerRole: 'write',
		})
	})

	test('returns GitHub provider actors instead of the repository owner', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			provider: 'github',
			authorUserId: null,
			authorUsername: 'octocat',
			github: {
				nodeId: 'PR_kwDOExample',
				htmlUrl: 'https://github.com/octocat/notes/pull/1',
				draft: false,
				headSha: 'head-sha',
				baseSha: 'base-sha',
				mergedByUsername: 'hubot',
			},
		})
		vi.spyOn(repository, 'listEvents').mockResolvedValue([
			{
				...event,
				provider: 'github',
				actorUserId: null,
				actorUsername: 'reviewer',
			},
		])

		const result = await service.get(undefined, {
			...repositoryInput,
			number: 1,
		})

		expect(result.pullRequest.authorUsername).toBe('octocat')
		expect(result.pullRequest.github?.mergedByUsername).toBe('hubot')
		expect(result.events[0]?.actorUsername).toBe('reviewer')
	})

	test('rejects missing pull requests', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(undefined)

		await expect(
			service.get(undefined, { ...repositoryInput, number: 404 })
		).rejects.toBeInstanceOf(PullRequestNotFoundError)
	})

	test('edits a non-merged pull request and records through the repository', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const editSpy = vi
			.spyOn(repository, 'edit')
			.mockResolvedValue({ ...pullRequest, title: 'Updated' })

		expect(
			await service.edit(mockUserId, {
				...repositoryInput,
				number: 1,
				title: 'Updated',
				body: undefined,
			})
		).toEqual(expect.objectContaining({ title: 'Updated' }))
		expect(editSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				actorUserId: mockUserId,
				expectedState: 'open',
			})
		)
	})

	test('rejects edits on merged pull requests', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			closedAt: createdAt,
			mergedAt: createdAt,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
		})
		const editSpy = vi.spyOn(repository, 'edit')

		await expect(
			service.edit(mockUserId, {
				...repositoryInput,
				number: 1,
				title: 'Updated',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
		expect(editSpy).not.toHaveBeenCalled()
	})

	test('closes and reopens through state-checked repository mutations', async () => {
		const findSpy = vi.spyOn(repository, 'find')
		findSpy.mockResolvedValueOnce(pullRequest).mockResolvedValueOnce({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'close').mockResolvedValue({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'reopen').mockResolvedValue(pullRequest)

		expect(
			await service.close(mockUserId, { ...repositoryInput, number: 1 })
		).toEqual(expect.objectContaining({ state: 'closed' }))
		expect(
			await service.reopen(mockUserId, { ...repositoryInput, number: 1 })
		).toEqual(expect.objectContaining({ state: 'open' }))
	})

	test('rejects stale lifecycle updates', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'close').mockResolvedValue(undefined)

		await expect(
			service.close(mockUserId, { ...repositoryInput, number: 1 })
		).rejects.toBeInstanceOf(PullRequestStateConflictError)
	})

	test('maps reopen branch pair uniqueness to a conflict', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'closed',
			closedAt: createdAt,
		})
		vi.spyOn(repository, 'reopen').mockRejectedValue({
			code: '23505',
			constraint: 'pull_requests_open_branch_pair_unique',
		})

		await expect(
			service.reopen(mockUserId, { ...repositoryInput, number: 1 })
		).rejects.toBeInstanceOf(PullRequestAlreadyOpenError)
	})

	test('returns the current three-dot branch comparison', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'base-sha',
				headSha: 'head-sha',
				mergeBaseSha: 'merge-base-sha',
				commits: [
					{
						sha: 'commit-sha',
						shortSha: 'commit-',
						summary: 'Feature',
						author: {
							name: 'Ada',
							email: 'ada@example.com',
							date: '2026-07-11T00:00:00Z',
						},
					},
				],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		expect(
			await service.comparison(undefined, {
				...repositoryInput,
				number: 1,
			})
		).toMatchObject({
			commits: [{ author: { date: new Date('2026-07-11T00:00:00Z') } }],
		})
		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'main',
			headRef: 'feature',
		})
	})

	test('uses the persisted merge commit parents for merged comparisons', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			state: 'merged',
			mergeCommitSha: 'c'.repeat(40),
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		})
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				commits: [],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: `${'c'.repeat(40)}^1`,
			headRef: `${'c'.repeat(40)}^2`,
		})
	})

	test('uses provider SHAs for merged GitHub comparisons', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue({
			...pullRequest,
			provider: 'github',
			authorUserId: null,
			authorUsername: 'octocat',
			state: 'merged',
			mergeCommitSha: 'c'.repeat(40),
			mergeActorUserId: null,
			mergedAt: createdAt,
			closedAt: createdAt,
			github: {
				nodeId: 'PR_kwDOExample',
				htmlUrl: 'https://github.com/octocat/notes/pull/1',
				draft: false,
				headSha: 'b'.repeat(40),
				baseSha: 'a'.repeat(40),
			},
		})
		const compareSpy = vi
			.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				commits: [],
				files: [],
				isTruncated: false,
				commitsTruncated: false,
				commitLimit: 500,
				fileLimit: 300,
			})

		await service.comparison(undefined, { ...repositoryInput, number: 1 })

		expect(compareSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'a'.repeat(40),
			headRef: 'b'.repeat(40),
		})
	})

	test('pins lazy file diffs to the displayed comparison SHAs', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const fileDiffSpy = vi
			.spyOn(gitStorageClient, 'getRepositoryFileDiff')
			.mockResolvedValue({
				baseSha: 'a'.repeat(40),
				headSha: 'b'.repeat(40),
				mergeBaseSha: 'a'.repeat(40),
				file: {
					status: 'modified',
					oldPath: 'src/index.ts',
					newPath: 'src/index.ts',
					additions: 1,
					deletions: 0,
					isBinary: false,
				},
				hunks: [],
				isTruncated: false,
				patchLimitBytes: 2_097_152,
			})

		await service.fileDiff(undefined, {
			...repositoryInput,
			number: 1,
			path: 'src/index.ts',
			expectedBaseSha: 'a'.repeat(40),
			expectedHeadSha: 'b'.repeat(40),
		})

		expect(fileDiffSpy).toHaveBeenCalledWith({
			...repositoryContext,
			baseRef: 'a'.repeat(40),
			headRef: 'b'.repeat(40),
			path: 'src/index.ts',
		})
	})

	test('claims the merge before Git and completes persistence afterward', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		const claimMergeSpy = vi
			.spyOn(repository, 'claimMerge')
			.mockResolvedValue(pullRequest)
		const mergeGitSpy = vi
			.spyOn(gitStorageClient, 'mergeRepositoryRefs')
			.mockResolvedValue('merge-sha')
		const completeMergeSpy = vi
			.spyOn(repository, 'completeMerge')
			.mockResolvedValue({
				...pullRequest,
				state: 'merged',
				mergeCommitSha: 'merge-sha',
				mergeActorUserId: mockUserId,
				mergedAt: createdAt,
				closedAt: createdAt,
			})

		expect(
			await service.merge(
				{
					id: mockUserId,
					name: 'Ada',
					email: 'ada@example.com',
				},
				{
					...repositoryInput,
					number: 1,
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
				}
			)
		).toMatchObject({ state: 'merged', mergeCommitSha: 'merge-sha' })
		expect(mergeGitSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				operationId: pullRequestId,
				expectedBaseSha: 'a'.repeat(40),
				expectedHeadSha: 'b'.repeat(40),
			})
		)
		expect(claimMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				attemptId: expect.any(String),
			})
		)
		expect(completeMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				mergeCommitSha: 'merge-sha',
				attemptId: expect.any(String),
			})
		)
		expect(claimMergeSpy.mock.invocationCallOrder[0]).toBeLessThan(
			mergeGitSpy.mock.invocationCallOrder[0] ?? 0
		)
		expect(mergeGitSpy.mock.invocationCallOrder[0]).toBeLessThan(
			completeMergeSpy.mock.invocationCallOrder[0] ?? 0
		)
	})

	test('returns the concurrent persisted merge after Git idempotency wins', async () => {
		const mergedPullRequest = {
			...pullRequest,
			state: 'merged' as const,
			mergeCommitSha: 'merge-sha',
			mergeActorUserId: mockUserId,
			mergedAt: createdAt,
			closedAt: createdAt,
		}
		vi.spyOn(repository, 'find')
			.mockResolvedValueOnce(pullRequest)
			.mockResolvedValueOnce(mergedPullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockResolvedValue(
			'merge-sha'
		)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'completeMerge').mockResolvedValue(undefined)

		expect(
			await service.merge(
				{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
				{
					...repositoryInput,
					number: 1,
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
				}
			)
		).toMatchObject({ state: 'merged', mergeCommitSha: 'merge-sha' })
	})

	test('releases the merge intent after a deterministic stale-ref failure', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'claimMerge').mockResolvedValue(pullRequest)
		vi.spyOn(gitStorageClient, 'mergeRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.ABORTED })
		)
		const releaseMergeSpy = vi
			.spyOn(repository, 'releaseMerge')
			.mockResolvedValue()

		await expect(
			service.merge(
				{ id: mockUserId, name: 'Ada', email: 'ada@example.com' },
				{
					...repositoryInput,
					number: 1,
					expectedBaseSha: 'a'.repeat(40),
					expectedHeadSha: 'b'.repeat(40),
				}
			)
		).rejects.toBeInstanceOf(PullRequestStaleComparisonError)
		expect(releaseMergeSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				pullRequestId,
				attemptId: expect.any(String),
			})
		)
	})
})

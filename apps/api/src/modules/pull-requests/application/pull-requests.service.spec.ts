import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequest, PullRequestEvent } from '@repo/db'
import type {
	PullRequestEventId,
	PullRequestId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	PullRequestAlreadyOpenError,
	PullRequestEditRequiredError,
	PullRequestInvalidBranchesError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
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
const pullRequest: PullRequest = {
	id: pullRequestId,
	repositoryId,
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
	actorUserId: mockUserId,
	type: 'opened',
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
					useValue: { listRepositoryRefs: vi.fn() },
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
		).mockResolvedValue(repositoryContext)
		vi.spyOn(
			repositoriesService,
			'getWritableRepositoryContext'
		).mockResolvedValue(repositoryContext)
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

	test('rejects identical source and target branches before storage reads', async () => {
		await expect(
			service.create(mockUserId, {
				...repositoryInput,
				sourceBranch: 'main',
				targetBranch: 'main',
				title: 'Invalid',
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestInvalidBranchesError)
		expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
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

		expect(
			await service.list(undefined, { ...repositoryInput, state: 'open' })
		).toHaveLength(1)
		expect(listSpy).toHaveBeenCalledWith({ repositoryId, state: 'open' })
	})

	test('gets a pull request with lifecycle events', async () => {
		vi.spyOn(repository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(repository, 'listEvents').mockResolvedValue([event])

		expect(
			await service.get(undefined, { ...repositoryInput, number: 1 })
		).toEqual({
			pullRequest: expect.objectContaining({ id: pullRequestId }),
			events: [event],
		})
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

	test('rejects empty edits', async () => {
		await expect(
			service.edit(mockUserId, {
				...repositoryInput,
				number: 1,
				title: undefined,
				body: undefined,
			})
		).rejects.toBeInstanceOf(PullRequestEditRequiredError)
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
})

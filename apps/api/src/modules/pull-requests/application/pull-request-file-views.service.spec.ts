import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	PullRequestId,
	PullRequestReviewId,
	RepositoryId,
	RepositorySlug,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import {
	PullRequestFileViewLimitError,
	PullRequestHeadUnresolvedError,
} from '../domain/pull-request-file-view.errors'
import { PullRequestFileViewsRepository } from '../infrastructure/pull-request-file-views.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { PullRequestFileViewsService } from './pull-request-file-views.service'
import { PullRequestHeadResolver } from './pull-request-head.resolver'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const expectedHeadSha = 'b'.repeat(40)
const changedFile = {
	status: 'modified' as const,
	oldPath: 'src/index.ts',
	newPath: 'src/index.ts',
	baseBlobId: 'base-blob',
	headBlobId: 'head-blob',
	additions: 1,
	deletions: 0,
	isBinary: false,
}
const comparison = {
	baseSha: 'a'.repeat(40),
	headSha: expectedHeadSha,
	mergeBaseSha: 'a'.repeat(40),
	commits: [],
	commitsTruncated: false,
	commitLimit: 500,
	files: [changedFile],
	isTruncated: false,
	fileLimit: 300,
}
const input = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
	expectedHeadSha,
}
const pullRequest: PullRequestReadModel = {
	id: pullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'a'.repeat(40),
	openingHeadSha: expectedHeadSha,
	title: 'Feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	createdAt: new Date('2026-08-17T10:00:00Z'),
	updatedAt: new Date('2026-08-17T10:00:00Z'),
	lastActivityAt: new Date('2026-08-17T10:00:00Z'),
	closedAt: null,
	mergedAt: null,
	github: undefined,
}

describe(PullRequestFileViewsService.name, () => {
	let moduleRef: TestingModule
	let service: PullRequestFileViewsService
	let fileViewsRepository: PullRequestFileViewsRepository
	let pullRequestsRepository: PullRequestsRepository
	let headResolver: PullRequestHeadResolver
	let repositoriesService: RepositoriesService
	let reviewsRepository: PullRequestReviewsRepository
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestFileViewsService,
				{
					provide: PullRequestFileViewsRepository,
					useValue: {
						listViews: vi.fn(),
						markViewed: vi.fn(),
						clearViewed: vi.fn(),
					},
				},
				{
					provide: PullRequestReviewsRepository,
					useValue: { listReviewHistory: vi.fn() },
				},
				{
					provide: GitStorageClient,
					useValue: { compareRepositoryRefs: vi.fn() },
				},
				{
					provide: PullRequestsRepository,
					useValue: { find: vi.fn() },
				},
				{
					provide: PullRequestHeadResolver,
					useValue: { resolveComparisonHeadSha: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: { getReadableRepositoryContext: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(PullRequestFileViewsService)
		fileViewsRepository = moduleRef.get(PullRequestFileViewsRepository)
		pullRequestsRepository = moduleRef.get(PullRequestsRepository)
		headResolver = moduleRef.get(PullRequestHeadResolver)
		repositoriesService = moduleRef.get(RepositoriesService)
		reviewsRepository = moduleRef.get(PullRequestReviewsRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)

		vi.spyOn(
			repositoriesService,
			'getReadableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			storagePath: '/repositories/notes.git',
			viewerRole: 'read',
			tesseraWritesAllowed: true,
		})
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(pullRequest)
		vi.spyOn(headResolver, 'resolveComparisonHeadSha').mockResolvedValue(
			expectedHeadSha
		)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockResolvedValue(
			comparison
		)
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([])
		vi.spyOn(fileViewsRepository, 'listViews').mockResolvedValue([])
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('authorizes through the readable repository context and keeps ticks whose blobs still stand', async () => {
		const listViewsSpy = vi
			.spyOn(fileViewsRepository, 'listViews')
			.mockResolvedValue([
				{
					path: 'src/renamed.ts',
					baseBlobId: 'base-blob',
					headBlobId: 'head-blob',
					headSha: 'c'.repeat(40),
				},
				{
					path: 'src/gone.ts',
					baseBlobId: 'stale-base',
					headBlobId: 'stale-head',
					headSha: expectedHeadSha,
				},
			])

		expect(await service.listViewedFiles(mockUserId, input)).toEqual({
			headSha: expectedHeadSha,
			paths: ['src/index.ts'],
			changedSinceReviewPaths: [],
			reviewHeadSha: undefined,
		})
		expect(
			repositoriesService.getReadableRepositoryContext
		).toHaveBeenCalledWith(mockUserId, { username: 'marta', slug: 'notes' })
		expect(listViewsSpy).toHaveBeenCalledWith({
			pullRequestId,
			userId: mockUserId,
		})
	})

	test('marks the files the head moved on since the viewer last reviewed', async () => {
		const reviewHeadSha = 'd'.repeat(40)
		vi.spyOn(reviewsRepository, 'listReviewHistory').mockResolvedValue([
			{
				id: '00000000-0000-4000-8000-000000000077' as PullRequestReviewId,
				reviewer: { userId: mockUserId },
				state: 'submitted',
				outcome: 'approve',
				body: '',
				headSha: reviewHeadSha,
				submittedAt: new Date('2026-08-18T10:00:00Z'),
				dismissedAt: null,
				dismissedBy: {},
				sourceUrl: null,
			} as never,
		])
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs')
			.mockResolvedValueOnce(comparison)
			.mockResolvedValueOnce({
				...comparison,
				files: [{ ...changedFile, newPath: 'src/late.ts' }],
			})

		expect(await service.listViewedFiles(mockUserId, input)).toEqual({
			headSha: expectedHeadSha,
			paths: [],
			changedSinceReviewPaths: ['src/late.ts'],
			reviewHeadSha,
		})
		expect(gitStorageClient.compareRepositoryRefs).toHaveBeenLastCalledWith({
			repositoryId,
			storagePath: '/repositories/notes.git',
			baseRef: reviewHeadSha,
			headRef: expectedHeadSha,
		})
	})

	test('rejects a missing pull request', async () => {
		vi.spyOn(pullRequestsRepository, 'find').mockResolvedValue(undefined)

		await expect(
			service.listViewedFiles(mockUserId, input)
		).rejects.toBeInstanceOf(PullRequestNotFoundError)
	})

	test('reports an unresolved head as service unavailable', async () => {
		vi.spyOn(headResolver, 'resolveComparisonHeadSha').mockResolvedValue(
			undefined
		)

		await expect(service.listViewedFiles(mockUserId, input)).rejects.toSatisfy(
			(error: PullRequestHeadUnresolvedError) =>
				error instanceof PullRequestHeadUnresolvedError &&
				error.code === 'SERVICE_UNAVAILABLE' &&
				error.context?.pullRequestId === pullRequestId &&
				error.context.expectedHeadSha === expectedHeadSha
		)
	})

	test('rejects a stale expected head on the list and tolerates it on a tick', async () => {
		const movedHeadSha = 'c'.repeat(40)
		vi.spyOn(headResolver, 'resolveComparisonHeadSha').mockResolvedValue(
			movedHeadSha
		)
		vi.spyOn(fileViewsRepository, 'markViewed').mockResolvedValue('marked')

		await expect(
			service.listViewedFiles(mockUserId, input)
		).rejects.toBeInstanceOf(PullRequestStaleComparisonError)
		expect(
			await service.setFileViewed(mockUserId, {
				...input,
				path: 'src/index.ts',
				viewed: true,
			})
		).toEqual({ path: 'src/index.ts', headSha: movedHeadSha, viewed: true })
	})

	test('clears viewed state idempotently', async () => {
		const clearViewedSpy = vi.spyOn(fileViewsRepository, 'clearViewed')

		expect(
			await service.setFileViewed(mockUserId, {
				...input,
				path: 'src/index.ts',
				viewed: false,
			})
		).toEqual({ path: 'src/index.ts', headSha: expectedHeadSha, viewed: false })
		expect(clearViewedSpy).toHaveBeenCalledWith({
			pullRequestId,
			userId: mockUserId,
			path: 'src/index.ts',
			baseBlobId: undefined,
			headBlobId: undefined,
		})
		expect(fileViewsRepository.markViewed).not.toHaveBeenCalled()
	})

	test.each([
		'marked',
		'already_viewed',
	] as const)('treats %s as a successful viewed state', async result => {
		const markViewedSpy = vi
			.spyOn(fileViewsRepository, 'markViewed')
			.mockResolvedValue(result)

		expect(
			await service.setFileViewed(mockUserId, {
				...input,
				path: 'src/index.ts',
				viewed: true,
				baseBlobId: 'base-blob',
				headBlobId: 'head-blob',
			})
		).toEqual({ path: 'src/index.ts', headSha: expectedHeadSha, viewed: true })
		expect(markViewedSpy).toHaveBeenCalledWith({
			pullRequestId,
			userId: mockUserId,
			headSha: expectedHeadSha,
			path: 'src/index.ts',
			baseBlobId: 'base-blob',
			headBlobId: 'head-blob',
			limit: 1000,
		})
	})

	test('maps the repository cap result to a conflict', async () => {
		vi.spyOn(fileViewsRepository, 'markViewed').mockResolvedValue(
			'limit_reached'
		)

		await expect(
			service.setFileViewed(mockUserId, {
				...input,
				path: 'src/index.ts',
				viewed: true,
			})
		).rejects.toSatisfy(
			(error: PullRequestFileViewLimitError) =>
				error instanceof PullRequestFileViewLimitError &&
				error.code === 'CONFLICT' &&
				error.context?.limit === 1000
		)
	})
})

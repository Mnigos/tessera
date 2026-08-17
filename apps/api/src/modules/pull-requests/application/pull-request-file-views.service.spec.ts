import { RepositoriesService } from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequestId, RepositoryId, RepositorySlug } from '@repo/domain'
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
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { PullRequestFileViewsService } from './pull-request-file-views.service'
import { PullRequestHeadResolver } from './pull-request-head.resolver'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const expectedHeadSha = 'b'.repeat(40)
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
	diffStatsUpdatedAt: null,
	createdAt: new Date('2026-08-17T10:00:00Z'),
	updatedAt: new Date('2026-08-17T10:00:00Z'),
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

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestFileViewsService,
				{
					provide: PullRequestFileViewsRepository,
					useValue: {
						listPaths: vi.fn(),
						markViewed: vi.fn(),
						clearViewed: vi.fn(),
					},
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
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('authorizes through the readable repository context and lists current-head paths', async () => {
		const listPathsSpy = vi
			.spyOn(fileViewsRepository, 'listPaths')
			.mockResolvedValue([' src/index.ts '])

		expect(await service.listViewedFiles(mockUserId, input)).toEqual({
			headSha: expectedHeadSha,
			paths: [' src/index.ts '],
		})
		expect(
			repositoriesService.getReadableRepositoryContext
		).toHaveBeenCalledWith(mockUserId, { username: 'marta', slug: 'notes' })
		expect(listPathsSpy).toHaveBeenCalledWith({
			pullRequestId,
			userId: mockUserId,
			headSha: expectedHeadSha,
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

	test('rejects a stale expected head', async () => {
		vi.spyOn(headResolver, 'resolveComparisonHeadSha').mockResolvedValue(
			'c'.repeat(40)
		)

		await expect(
			service.listViewedFiles(mockUserId, input)
		).rejects.toBeInstanceOf(PullRequestStaleComparisonError)
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
			headSha: expectedHeadSha,
			path: 'src/index.ts',
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
			})
		).toEqual({ path: 'src/index.ts', headSha: expectedHeadSha, viewed: true })
		expect(markViewedSpy).toHaveBeenCalledWith({
			pullRequestId,
			userId: mockUserId,
			headSha: expectedHeadSha,
			path: 'src/index.ts',
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

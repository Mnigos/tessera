import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import { repositoryBrowserSummarySchema } from '@repo/contracts'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoriesController } from './repositories.controller'
import { RepositoryBrowserController } from './repository-browser.controller'
import { RepositoryOwnerGuard } from './repository-owner.guard'

const repository = {
	repository: {
		id: '00000000-0000-4000-8000-000000000002' as RepositoryId,
		slug: 'notes' as RepositorySlug,
		name: 'Notes' as RepositoryName,
		visibility: 'private' as const,
		description: undefined,
		defaultBranch: 'main',
		createdAt: new Date('2026-05-12T00:00:00Z'),
		updatedAt: new Date('2026-05-12T00:00:00Z'),
	},
	owner: {
		username: 'marta',
	},
}

const session = createMockSession()

describe(RepositoriesController.name, () => {
	let moduleRef: TestingModule
	let repositoriesController: RepositoriesController
	let repositoryBrowserController: RepositoryBrowserController
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [RepositoriesController, RepositoryBrowserController],
			providers: [
				{
					provide: RepositoriesService,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						get: vi.fn(),
						getBrowserSummary: vi.fn(),
					},
				},
				{
					provide: RepositoryOwnerGuard,
					useValue: {
						canActivate: vi.fn(),
					},
				},
				{
					provide: UserService,
					useValue: {
						findUserId: vi.fn(),
					},
				},
			],
		}).compile()

		repositoriesController = moduleRef.get(RepositoriesController)
		repositoryBrowserController = moduleRef.get(RepositoryBrowserController)
		repositoriesService = moduleRef.get(RepositoriesService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates create requests to the repositories service', async () => {
		const createSpy = vi
			.spyOn(repositoriesService, 'create')
			.mockResolvedValue(repository)

		expect(
			await repositoriesController.create(session)['~orpc'].handler({
				input: { name: 'Notes' },
				context: {},
				path: ['repositories', 'create'],
				procedure: repositoriesController.create(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(repository)
		expect(createSpy).toHaveBeenCalledWith(mockUserId, 'marta', {
			name: 'Notes',
		})
	})

	test('delegates list requests to the repositories service', async () => {
		const listSpy = vi
			.spyOn(repositoriesService, 'list')
			.mockResolvedValue([repository])

		expect(
			await repositoriesController.list(mockUserId)['~orpc'].handler({
				input: { username: 'marta' },
				context: {},
				path: ['repositories', 'list'],
				procedure: repositoriesController.list(mockUserId),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ repositories: [repository] })
		expect(listSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates get requests to the repositories service', async () => {
		const getSpy = vi
			.spyOn(repositoriesService, 'get')
			.mockResolvedValue(repository)

		expect(
			await repositoriesController.get(mockUserId)['~orpc'].handler({
				input: { username: 'marta', slug: repository.repository.slug },
				context: {},
				path: ['repositories', 'get'],
				procedure: repositoriesController.get(mockUserId),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(repository)
		expect(getSpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('delegates browser summary requests with an optional viewer', async () => {
		const browserSummary = {
			...repository,
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'README.md',
					objectId: 'abc123',
					kind: 'file' as const,
					sizeBytes: 42,
					path: 'README.md',
					mode: '100644',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'abc123',
				content: '# Tessera',
				isTruncated: false,
			},
		}
		const getBrowserSummarySpy = vi
			.spyOn(repositoriesService, 'getBrowserSummary')
			.mockResolvedValue(browserSummary)

		expect(
			await repositoryBrowserController
				.getBrowserSummary(session)
				['~orpc'].handler({
					input: { username: 'marta', slug: repository.repository.slug },
					context: {},
					path: ['repositories', 'getBrowserSummary'],
					procedure: repositoryBrowserController.getBrowserSummary(session),
					lastEventId: undefined,
					errors: {},
				})
		).toEqual(browserSummary)
		expect(getBrowserSummarySpy).toHaveBeenCalledWith(mockUserId, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('delegates anonymous browser summary requests without a viewer', async () => {
		const browserSummary = {
			...repository,
			isEmpty: true,
			defaultBranch: 'main',
			rootEntries: [],
			readme: undefined,
		}
		const getBrowserSummarySpy = vi
			.spyOn(repositoriesService, 'getBrowserSummary')
			.mockResolvedValue(browserSummary)

		expect(
			await repositoryBrowserController.getBrowserSummary()['~orpc'].handler({
				input: { username: 'marta', slug: repository.repository.slug },
				context: {},
				path: ['repositories', 'getBrowserSummary'],
				procedure: repositoryBrowserController.getBrowserSummary(),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(browserSummary)
		expect(getBrowserSummarySpy).toHaveBeenCalledWith(undefined, {
			username: 'marta',
			slug: repository.repository.slug,
		})
	})

	test('validates browser summary contract output without storage path', () => {
		expect(
			repositoryBrowserSummarySchema.parse({
				...repository,
				isEmpty: false,
				defaultBranch: 'main',
				rootEntries: [
					{
						name: 'README.md',
						objectId: 'abc123',
						kind: 'file',
						sizeBytes: 42,
						path: 'README.md',
						mode: '100644',
					},
				],
				readme: {
					filename: 'README.md',
					objectId: 'abc123',
					content: '# Tessera',
					isTruncated: false,
				},
			})
		).toEqual(
			expect.not.objectContaining({
				storagePath: expect.any(String),
			})
		)
	})
})

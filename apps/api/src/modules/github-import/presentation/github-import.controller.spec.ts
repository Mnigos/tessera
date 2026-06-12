import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubImportRepository,
	GitHubRepositoryImport,
} from '@repo/contracts'
import type { RepositoryImportId } from '@repo/db'
import type { RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { GitHubImportService } from '../application/github-import.service'
import { GitHubImportController } from './github-import.controller'

const session = createMockSession()
const repository: GitHubImportRepository = {
	githubId: '123',
	ownerLogin: 'marta',
	name: 'tessera',
	fullName: 'marta/tessera',
	visibility: 'private',
	defaultBranch: 'main',
	pushedAt: new Date('2026-05-10T12:34:56Z'),
	githubUrl: 'https://github.com/marta/tessera',
}
const repositoryImport: GitHubRepositoryImport = {
	id: '00000000-0000-4000-8000-000000000029' as RepositoryImportId,
	provider: 'github',
	targetName: repository.name,
	targetSlug: 'tessera' as RepositorySlug,
	source: repository,
	status: 'pending',
	createdAt: new Date('2026-05-19T00:00:00Z'),
	updatedAt: new Date('2026-05-19T00:00:00Z'),
}

describe(GitHubImportController.name, () => {
	let moduleRef: TestingModule
	let githubImportController: GitHubImportController
	let githubImportService: GitHubImportService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [GitHubImportController],
			providers: [
				{
					provide: GitHubImportService,
					useValue: {
						listRepositories: vi.fn(),
						createImport: vi.fn(),
						listImports: vi.fn(),
						getImport: vi.fn(),
						retryImport: vi.fn(),
					},
				},
			],
		}).compile()

		githubImportController = moduleRef.get(GitHubImportController)
		githubImportService = moduleRef.get(GitHubImportService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates list repository requests to the service', async () => {
		const listRepositoriesSpy = vi
			.spyOn(githubImportService, 'listRepositories')
			.mockResolvedValue([repository])

		expect(
			await githubImportController.listRepositories(session)['~orpc'].handler({
				input: undefined,
				context: {},
				path: ['githubImport', 'listRepositories'],
				procedure: githubImportController.listRepositories(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ repositories: [repository] })
		expect(listRepositoriesSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates create import requests to the service', async () => {
		const createImportSpy = vi
			.spyOn(githubImportService, 'createImport')
			.mockResolvedValue(repositoryImport)

		expect(
			await githubImportController.createImport(session)['~orpc'].handler({
				input: { githubId: '123' },
				context: {},
				path: ['githubImport', 'createImport'],
				procedure: githubImportController.createImport(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ import: repositoryImport })
		expect(createImportSpy).toHaveBeenCalledWith(mockUserId, {
			githubId: '123',
		})
	})

	test('delegates list import requests to the service', async () => {
		const listImportsSpy = vi
			.spyOn(githubImportService, 'listImports')
			.mockResolvedValue([repositoryImport])

		expect(
			await githubImportController.listImports(session)['~orpc'].handler({
				input: undefined,
				context: {},
				path: ['githubImport', 'listImports'],
				procedure: githubImportController.listImports(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ imports: [repositoryImport] })
		expect(listImportsSpy).toHaveBeenCalledWith(mockUserId)
	})

	test('delegates get import requests to the service', async () => {
		const getImportSpy = vi
			.spyOn(githubImportService, 'getImport')
			.mockResolvedValue(repositoryImport)

		expect(
			await githubImportController.getImport(session)['~orpc'].handler({
				input: { id: repositoryImport.id },
				context: {},
				path: ['githubImport', 'getImport'],
				procedure: githubImportController.getImport(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ import: repositoryImport })
		expect(getImportSpy).toHaveBeenCalledWith(mockUserId, {
			id: repositoryImport.id,
		})
	})

	test('delegates retry import requests to the service', async () => {
		const retryImportSpy = vi
			.spyOn(githubImportService, 'retryImport')
			.mockResolvedValue(repositoryImport)

		expect(
			await githubImportController.retryImport(session)['~orpc'].handler({
				input: { id: repositoryImport.id },
				context: {},
				path: ['githubImport', 'retryImport'],
				procedure: githubImportController.retryImport(session),
				lastEventId: undefined,
				errors: {},
			})
		).toEqual({ import: repositoryImport })
		expect(retryImportSpy).toHaveBeenCalledWith(mockUserId, {
			id: repositoryImport.id,
		})
	})
})

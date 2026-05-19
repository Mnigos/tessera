import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubImportRepository } from '@repo/contracts'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { GitHubImportService } from '../application/github-import.service'
import { GitHubImportController } from './github-import.controller'

const session = createMockSession()
const repository: GitHubImportRepository = {
	githubId: 123,
	ownerLogin: 'marta',
	name: 'tessera',
	fullName: 'marta/tessera',
	visibility: 'private',
	defaultBranch: 'main',
	pushedAt: new Date('2026-05-10T12:34:56Z'),
	githubUrl: 'https://github.com/marta/tessera',
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
})

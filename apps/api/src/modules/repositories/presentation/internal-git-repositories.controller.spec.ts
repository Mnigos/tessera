import { EnvService } from '@config/env'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, RepositorySlug } from '@repo/domain'
import { BadRequestError } from '~/shared/errors'
import { RepositoriesService } from '../application/repositories.service'
import { InternalBearerTokenGuard } from './internal-bearer-token.guard'
import { InternalGitRepositoriesController } from './internal-git-repositories.controller'

describe(InternalGitRepositoriesController.name, () => {
	let moduleRef: TestingModule
	let controller: InternalGitRepositoriesController
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [InternalGitRepositoriesController],
			providers: [
				{
					provide: RepositoriesService,
					useValue: {
						authorizeGitRepositoryRead: vi.fn(),
					},
				},
				{
					provide: InternalBearerTokenGuard,
					useValue: {
						canActivate: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn(),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(InternalGitRepositoriesController)
		repositoriesService = moduleRef.get(RepositoriesService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates valid authorize read requests to the repositories service', async () => {
		const authorizeGitRepositoryReadSpy = vi
			.spyOn(repositoriesService, 'authorizeGitRepositoryRead')
			.mockResolvedValue({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
			})

		expect(
			await controller.authorizeRead({
				username: 'marta',
				slug: 'notes',
			})
		).toEqual({
			repositoryId: '00000000-0000-4000-8000-000000000002',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(authorizeGitRepositoryReadSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes' as RepositorySlug,
		})
	})

	test('rejects invalid authorize read request bodies', () => {
		expect(() =>
			controller.authorizeRead({
				username: 'marta',
				slug: '../notes',
			})
		).toThrow(BadRequestError)
	})
})

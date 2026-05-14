import { EnvService } from '@config/env'
import { status } from '@grpc/grpc-js'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, RepositorySlug } from '@repo/domain'
import {
	ForbiddenError,
	InternalError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'
import { GitAuthorizationGrpcController } from './git-authorization.grpc.controller'

describe(GitAuthorizationGrpcController.name, () => {
	let moduleRef: TestingModule
	let controller: GitAuthorizationGrpcController
	let repositoriesService: RepositoriesService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [GitAuthorizationGrpcController],
			providers: [
				{
					provide: RepositoriesService,
					useValue: {
						authorizeGitRepositoryRead: vi.fn(),
						authorizeGitRepositoryWrite: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn().mockReturnValue('test-internal-token'),
					},
				},
			],
		}).compile()

		controller = moduleRef.get(GitAuthorizationGrpcController)
		repositoriesService = moduleRef.get(RepositoriesService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates authorize read requests to the repositories service', async () => {
		const authorizeGitRepositoryReadSpy = vi
			.spyOn(repositoriesService, 'authorizeGitRepositoryRead')
			.mockResolvedValue({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedUser: '',
			})

		expect(
			await controller.authorizeRead({
				ownerUsername: 'marta',
				repositorySlug: 'notes',
				service: 'git-upload-pack',
				action: 'read',
			})
		).toEqual({
			repositoryId: '00000000-0000-4000-8000-000000000002',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '',
		})
		expect(authorizeGitRepositoryReadSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes' as RepositorySlug,
		})
	})

	test('delegates authorize write requests to the repositories service', async () => {
		const authorizeGitRepositoryWriteSpy = vi
			.spyOn(repositoriesService, 'authorizeGitRepositoryWrite')
			.mockResolvedValue({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedUser: '00000000-0000-4000-8000-000000000001',
			})

		await controller.authorizeWrite({
			ownerUsername: 'marta',
			repositorySlug: 'notes',
			service: 'git-receive-pack',
			action: 'write',
			basicUsername: 'marta',
			token: 'tes_git_raw-secret',
		})

		expect(authorizeGitRepositoryWriteSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes' as RepositorySlug,
			rawToken: 'tes_git_raw-secret',
		})
	})

	test('maps authentication errors to unauthenticated grpc status', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue(new UnauthorizedError('git authorization'))

		await expect(
			controller.authorizeRead({
				ownerUsername: 'marta',
				repositorySlug: 'notes',
				service: 'git-upload-pack',
				action: 'read',
			})
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.UNAUTHENTICATED }),
		})
	})

	test('maps domain errors to grpc statuses', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryWrite'
		).mockRejectedValue(new ForbiddenError('repository git write'))

		await expect(
			controller.authorizeWrite({
				ownerUsername: 'marta',
				repositorySlug: 'notes',
				service: 'git-receive-pack',
				action: 'write',
				basicUsername: 'marta',
				token: 'tes_git_raw-secret',
			})
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.PERMISSION_DENIED }),
		})
	})

	test('maps missing repositories to not found grpc status', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue(new NotFoundError('repository'))

		await expect(
			controller.authorizeRead({
				ownerUsername: 'marta',
				repositorySlug: 'missing',
				service: 'git-upload-pack',
				action: 'read',
			})
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.NOT_FOUND }),
		})
	})

	test('maps failed preconditions and unknown errors to grpc statuses', async () => {
		vi.spyOn(repositoriesService, 'authorizeGitRepositoryWrite')
			.mockRejectedValueOnce(new RepositoryStoragePathMissingError())
			.mockRejectedValueOnce(new Error('boom'))
			.mockRejectedValueOnce(new InternalError('repository create'))

		await expect(
			controller.authorizeWrite(createWriteRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.FAILED_PRECONDITION }),
		})
		await expect(
			controller.authorizeWrite(createWriteRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.INTERNAL }),
		})
		await expect(
			controller.authorizeWrite(createWriteRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.INTERNAL }),
		})
	})
})

function createWriteRequest() {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-receive-pack',
		action: 'write',
		basicUsername: 'marta',
		token: 'tes_git_raw-secret',
	}
}

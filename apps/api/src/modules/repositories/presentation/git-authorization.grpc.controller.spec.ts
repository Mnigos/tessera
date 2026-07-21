import { EnvService } from '@config/env'
import { status } from '@grpc/grpc-js'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import { RpcException } from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId, RepositorySlug, UserId } from '@repo/domain'
import {
	InternalError,
	NotFoundError,
	UnauthorizedError,
} from '~/shared/errors'
import { RepositoriesService } from '../application/repositories.service'
import { RepositoryStoragePathMissingError } from '../domain/repository.errors'
import { GitAuthorizationGrpcController } from './git-authorization.grpc.controller'
import { setGitRepositoryWriteAuthorization } from './git-repository-write-authorization.context'

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
						authenticateSshKey: vi.fn(),
						authorizeGitRepositoryRead: vi.fn(),
						authorizeSshGitRepositoryRead: vi.fn(),
					},
				},
				{
					provide: GitAccessTokensService,
					useValue: { verify: vi.fn() },
				},
				{
					provide: SshPublicKeysService,
					useValue: { findOwnerByFingerprint: vi.fn() },
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

	test('delegates ssh key authentication requests to the repositories service', async () => {
		const authenticateSshKeySpy = vi
			.spyOn(repositoriesService, 'authenticateSshKey')
			.mockResolvedValue({
				trustedUser: '00000000-0000-4000-8000-000000000001' as UserId,
			})

		expect(
			await controller.authenticateSshKey({
				username: 'git',
				fingerprint: 'SHA256:abc',
			})
		).toEqual({
			trustedUser: '00000000-0000-4000-8000-000000000001',
		})
		expect(authenticateSshKeySpy).toHaveBeenCalledWith({
			username: 'git',
			fingerprint: 'SHA256:abc',
		})
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
			await controller.authorizeRead(createReadRequest('tes_git_raw-secret'))
		).toEqual({
			repositoryId: '00000000-0000-4000-8000-000000000002',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '',
		})
		expect(authorizeGitRepositoryReadSpy).toHaveBeenCalledWith(
			{
				username: 'marta',
				slug: 'notes' as RepositorySlug,
			},
			'tes_git_raw-secret'
		)
	})

	test('returns guard-resolved HTTP write authorization', async () => {
		const request = {
			ownerUsername: 'marta',
			repositorySlug: 'notes',
			service: 'git-receive-pack',
			action: 'write',
			basicUsername: 'marta',
			token: 'tes_git_raw-secret',
		}
		const authorization = {
			repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		}
		setGitRepositoryWriteAuthorization(request, authorization)

		expect(await controller.authorizeWrite(request)).toBe(authorization)
	})

	test('delegates authorize ssh read requests to the repositories service', async () => {
		const authorizeSshGitRepositoryReadSpy = vi
			.spyOn(repositoriesService, 'authorizeSshGitRepositoryRead')
			.mockResolvedValue({
				repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedUser: '00000000-0000-4000-8000-000000000001',
			})

		expect(
			await controller.authorizeSshRead({
				ownerUsername: 'marta',
				repositorySlug: 'notes',
				service: 'git-upload-pack',
				action: 'upload_pack',
				fingerprint: 'SHA256:abc',
			})
		).toEqual({
			repositoryId: '00000000-0000-4000-8000-000000000002',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		})
		expect(authorizeSshGitRepositoryReadSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes' as RepositorySlug,
			fingerprint: 'SHA256:abc',
		})
	})

	test('returns guard-resolved SSH write authorization', async () => {
		const request = {
			ownerUsername: 'marta',
			repositorySlug: 'notes',
			service: 'git-receive-pack',
			action: 'receive_pack',
			fingerprint: 'SHA256:abc',
		}
		const authorization = {
			repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '00000000-0000-4000-8000-000000000001',
		}
		setGitRepositoryWriteAuthorization(request, authorization)

		expect(await controller.authorizeSshWrite(request)).toBe(authorization)
	})

	test('maps authentication errors to unauthenticated grpc status', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue(new UnauthorizedError('git authorization'))

		await expect(
			controller.authorizeRead(createReadRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.UNAUTHENTICATED }),
		})
	})

	test('maps missing repositories to not found grpc status', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue(new NotFoundError('repository'))

		await expect(
			controller.authorizeRead({
				...createReadRequest(),
				repositorySlug: 'missing',
			})
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.NOT_FOUND }),
		})
	})

	test('maps failed preconditions and unknown errors to grpc statuses', async () => {
		vi.spyOn(repositoriesService, 'authorizeGitRepositoryRead')
			.mockRejectedValueOnce(new RepositoryStoragePathMissingError())
			.mockRejectedValueOnce(new Error('boom'))
			.mockRejectedValueOnce(new InternalError('repository create'))

		await expect(
			controller.authorizeRead(createReadRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.FAILED_PRECONDITION }),
		})
		await expect(
			controller.authorizeRead(createReadRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.INTERNAL }),
		})
		await expect(
			controller.authorizeRead(createReadRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({ code: status.INTERNAL }),
		})
	})

	test('passes through existing rpc exceptions', async () => {
		const rpcException = new RpcException({
			code: status.UNAVAILABLE,
			message: 'git storage unavailable',
		})
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue(rpcException)

		await expect(controller.authorizeRead(createReadRequest())).rejects.toBe(
			rpcException
		)
	})

	test('uses a generic message for non-error exceptions', async () => {
		vi.spyOn(
			repositoriesService,
			'authorizeGitRepositoryRead'
		).mockRejectedValue('boom')

		await expect(
			controller.authorizeRead(createReadRequest())
		).rejects.toMatchObject({
			error: expect.objectContaining({
				code: status.INTERNAL,
				message: 'Internal error',
			}),
		})
	})
})

function createReadRequest(token = '') {
	return {
		ownerUsername: 'marta',
		repositorySlug: 'notes',
		service: 'git-upload-pack',
		action: 'read',
		basicUsername: token ? 'marta' : '',
		token,
	}
}

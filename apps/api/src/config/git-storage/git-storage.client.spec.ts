import type { ClientGrpc } from '@nestjs/microservices'
import type { RepositoryId } from '@repo/domain'
import { of, throwError } from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import { GitStorageClient } from './git-storage.client'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

describe(GitStorageClient.name, () => {
	let clientGrpc: Pick<ClientGrpc, 'getService'>
	let gitStorageService: {
		health: ReturnType<typeof vi.fn>
		createRepository: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		gitStorageService = {
			health: vi.fn(() => of({ status: 'SERVING' })),
			createRepository: vi.fn(() =>
				of({
					storagePath: '/var/lib/tessera/repositories/repo.git',
				})
			),
		}
		clientGrpc = {
			getService: vi.fn().mockReturnValue(gitStorageService),
		}
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('resolves the generated grpc service on module init', () => {
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		expect(clientGrpc.getService).toHaveBeenCalledWith('GitStorageService')
	})

	test('exposes typed health without leaking the grpc client', async () => {
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		await expect(client.health()).resolves.toEqual({ status: 'SERVING' })
		expect(gitStorageService.health).toHaveBeenCalledWith({})
	})

	test('creates repository storage with only repository id', async () => {
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		await expect(client.createRepository({ repositoryId })).resolves.toEqual({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(gitStorageService.createRepository).toHaveBeenCalledWith({
			repositoryId,
		})
	})

	test('maps missing storage path to an external service error', async () => {
		gitStorageService.createRepository.mockReturnValue(of({}))
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test('maps unavailable grpc errors to service unavailable', async () => {
		gitStorageService.createRepository.mockReturnValue(
			throwError(() => ({ code: 14 }))
		)
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(ServiceUnavailableError)
	})

	test('maps deadline grpc errors to gateway timeout', async () => {
		gitStorageService.createRepository.mockReturnValue(
			throwError(() => ({ code: 4 }))
		)
		const client = new GitStorageClient(clientGrpc as ClientGrpc)

		client.onModuleInit()

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(GatewayTimeoutError)
	})
})

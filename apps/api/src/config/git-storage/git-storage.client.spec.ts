import type { ClientGrpc } from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { of, throwError } from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import { RepositoryTreeEntryKind } from './generated/tessera/git/v1/git_storage'
import { GIT_STORAGE_GRPC_CLIENT, GitStorageClient } from './git-storage.client'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

describe(GitStorageClient.name, () => {
	let moduleRef: TestingModule
	let client: GitStorageClient
	let clientGrpc: Pick<ClientGrpc, 'getService'>
	let gitStorageService: {
		health: ReturnType<typeof vi.fn>
		createRepository: ReturnType<typeof vi.fn>
		getRepositoryBrowserSummary: ReturnType<typeof vi.fn>
	}

	beforeEach(async () => {
		gitStorageService = {
			health: vi.fn(() => of({ status: 'SERVING' })),
			createRepository: vi.fn(() =>
				of({
					storagePath: '/var/lib/tessera/repositories/repo.git',
				})
			),
			getRepositoryBrowserSummary: vi.fn(() =>
				of({
					isEmpty: false,
					defaultBranch: 'main',
					rootEntries: [
						{
							name: 'src',
							objectId: 'abc123',
							kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_DIRECTORY,
							sizeBytes: 0,
							path: 'src',
							mode: '040000',
						},
						{
							name: 'README.md',
							objectId: 'def456',
							kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE,
							sizeBytes: 42,
							path: 'README.md',
							mode: '100644',
						},
					],
					readme: {
						filename: 'README.md',
						objectId: 'def456',
						content: new TextEncoder().encode('# Tessera'),
						isTruncated: false,
					},
				})
			),
		}
		clientGrpc = {
			getService: vi.fn().mockReturnValue(gitStorageService),
		}

		moduleRef = await Test.createTestingModule({
			providers: [
				GitStorageClient,
				{
					provide: GIT_STORAGE_GRPC_CLIENT,
					useValue: clientGrpc,
				},
			],
		}).compile()
		await moduleRef.init()
		client = moduleRef.get(GitStorageClient)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('resolves the generated grpc service on module init', () => {
		expect(clientGrpc.getService).toHaveBeenCalledWith('GitStorageService')
	})

	test('exposes typed health without leaking the grpc client', async () => {
		await expect(client.health()).resolves.toEqual({ status: 'SERVING' })
		expect(gitStorageService.health).toHaveBeenCalledWith({})
	})

	test('creates repository storage with only repository id', async () => {
		await expect(client.createRepository({ repositoryId })).resolves.toEqual({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(gitStorageService.createRepository).toHaveBeenCalledWith({
			repositoryId,
		})
	})

	test('maps repository browser summary without exposing the storage path', async () => {
		await expect(
			client.getRepositoryBrowserSummary({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
			})
		).resolves.toEqual({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'src',
					objectId: 'abc123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
				{
					name: 'README.md',
					objectId: 'def456',
					kind: 'file',
					sizeBytes: 42,
					path: 'README.md',
					mode: '100644',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'def456',
				content: '# Tessera',
				isTruncated: false,
			},
		})
		expect(gitStorageService.getRepositoryBrowserSummary).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'main',
		})
	})

	test('maps missing storage path to an external service error', async () => {
		gitStorageService.createRepository.mockReturnValue(of({}))

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test('maps unavailable grpc errors to service unavailable', async () => {
		gitStorageService.createRepository.mockReturnValue(
			throwError(() => ({ code: 14 }))
		)

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(ServiceUnavailableError)
	})

	test('maps deadline grpc errors to gateway timeout', async () => {
		gitStorageService.createRepository.mockReturnValue(
			throwError(() => ({ code: 4 }))
		)

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(GatewayTimeoutError)
	})
})

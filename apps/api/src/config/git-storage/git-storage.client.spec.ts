import { EnvService } from '@config/env'
import { Metadata } from '@grpc/grpc-js'
import type { ClientGrpc } from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { of, throwError } from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import { mockRepositoryCommit } from '~/shared/mocks/repository-commit.mock'
import {
	RepositoryBlobPreviewState,
	RepositoryRefKind,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
import { GIT_STORAGE_GRPC_CLIENT, GitStorageClient } from './git-storage.client'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const trustedGpgKeys = [
	{
		keyId: '0123456789ABCDEF',
		fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
		publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
	},
]

describe(GitStorageClient.name, () => {
	let moduleRef: TestingModule
	let client: GitStorageClient
	let clientGrpc: Pick<ClientGrpc, 'getService'>
	let envService: EnvService
	let gitStorageService: {
		health: ReturnType<typeof vi.fn>
		createRepository: ReturnType<typeof vi.fn>
		importRepository: ReturnType<typeof vi.fn>
		getRepositoryBrowserSummary: ReturnType<typeof vi.fn>
		getRepositoryTree: ReturnType<typeof vi.fn>
		getRepositoryBlob: ReturnType<typeof vi.fn>
		getRepositoryRawBlob: ReturnType<typeof vi.fn>
		listRepositoryRefs: ReturnType<typeof vi.fn>
		listRepositoryCommits: ReturnType<typeof vi.fn>
	}

	beforeEach(async () => {
		gitStorageService = {
			health: vi.fn(() => of({ status: 'SERVING' })),
			createRepository: vi.fn(() =>
				of({
					storagePath: '/var/lib/tessera/repositories/repo.git',
				})
			),
			importRepository: vi.fn(() =>
				of({
					storagePath: '/var/lib/tessera/repositories/repo.git',
					defaultBranch: 'trunk',
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
			getRepositoryTree: vi.fn(() =>
				of({
					commitId: 'commit123',
					path: 'src',
					entries: [
						{
							name: 'index.ts',
							objectId: 'blob123',
							kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE,
							sizeBytes: 24,
							path: 'src/index.ts',
							mode: '100644',
						},
					],
				})
			),
			getRepositoryBlob: vi.fn(() =>
				of({
					objectId: 'blob123',
					state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TEXT,
					text: 'console.log("hi")',
					sizeBytes: 17,
					previewLimitBytes: 1_048_576,
				})
			),
			getRepositoryRawBlob: vi.fn(() =>
				of({
					objectId: 'blob123',
					content: new TextEncoder().encode('console.log("hi")'),
					sizeBytes: 17,
				})
			),
			listRepositoryRefs: vi.fn(() =>
				of({
					refs: [
						{
							kind: RepositoryRefKind.REPOSITORY_REF_KIND_BRANCH,
							displayName: 'main',
							qualifiedName: 'refs/heads/main',
							commitId: 'abc123',
							isDefaultBranch: true,
						},
						{
							kind: RepositoryRefKind.REPOSITORY_REF_KIND_TAG,
							displayName: 'v1.0.0',
							qualifiedName: 'refs/tags/v1.0.0',
							commitId: 'def456',
							isDefaultBranch: false,
						},
					],
				})
			),
			listRepositoryCommits: vi.fn(() =>
				of({
					commits: [mockRepositoryCommit],
				})
			),
		}
		clientGrpc = {
			getService: vi.fn().mockReturnValue(gitStorageService),
		}
		envService = {
			get: vi.fn().mockReturnValue('test-internal-token'),
		} as unknown as EnvService

		moduleRef = await Test.createTestingModule({
			providers: [
				GitStorageClient,
				{
					provide: GIT_STORAGE_GRPC_CLIENT,
					useValue: clientGrpc,
				},
				{
					provide: EnvService,
					useValue: envService,
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
		expect(await client.health()).toEqual({ status: 'SERVING' })
		expect(gitStorageService.health).toHaveBeenLastCalledWith(
			{},
			expect.any(Metadata)
		)
		expect(getGitStorageAuthorization(gitStorageService.health)).toEqual([
			'Bearer test-internal-token',
		])
	})

	test('creates repository storage with only repository id', async () => {
		expect(await client.createRepository({ repositoryId })).toEqual({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(gitStorageService.createRepository).toHaveBeenLastCalledWith(
			{
				repositoryId,
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.createRepository)
		).toEqual(['Bearer test-internal-token'])
	})

	test('imports repository storage with source metadata', async () => {
		expect(
			await client.importRepository({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				sourceUrl: 'https://github.com/marta/tessera',
				accessToken: 'github-token',
				defaultBranchHint: 'main',
			})
		).toEqual({
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
		})
		expect(gitStorageService.importRepository).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				sourceUrl: 'https://github.com/marta/tessera',
				accessToken: 'github-token',
				defaultBranchHint: 'main',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.importRepository)
		).toEqual(['Bearer test-internal-token'])
	})

	test('maps repository browser summary without exposing the storage path', async () => {
		expect(
			await client.getRepositoryBrowserSummary({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
			})
		).toEqual({
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
		expect(
			gitStorageService.getRepositoryBrowserSummary
		).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
				ref: '',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.getRepositoryBrowserSummary)
		).toEqual(['Bearer test-internal-token'])
	})

	test('normalizes grpc uint64 size values returned as strings', async () => {
		gitStorageService.getRepositoryBrowserSummary.mockReturnValue(
			of({
				isEmpty: false,
				defaultBranch: 'main',
				rootEntries: [
					{
						name: 'README.md',
						objectId: 'def456',
						kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE,
						sizeBytes: '42',
						path: 'README.md',
						mode: '100644',
					},
				],
				readme: undefined,
			})
		)

		expect(
			await client.getRepositoryBrowserSummary({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
			})
		).toEqual(
			expect.objectContaining({
				rootEntries: [
					expect.objectContaining({
						sizeBytes: 42,
					}),
				],
			})
		)
	})

	test('passes an optional browser summary ref to git storage', async () => {
		await client.getRepositoryBrowserSummary({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'main',
			ref: 'feature/ref-browser',
		})

		expect(
			gitStorageService.getRepositoryBrowserSummary
		).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
				ref: 'feature/ref-browser',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.getRepositoryBrowserSummary)
		).toEqual(['Bearer test-internal-token'])
	})

	test('lists repository refs without exposing storage fields', async () => {
		expect(
			await client.listRepositoryRefs({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedGpgKeys,
			})
		).toEqual({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'abc123',
				},
			],
			tags: [
				{
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'def456',
				},
			],
		})
		expect(gitStorageService.listRepositoryRefs).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				trustedGpgKeys,
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.listRepositoryRefs)
		).toEqual(['Bearer test-internal-token'])
	})

	test('maps repository tree entries and normalizes uint64 values', async () => {
		gitStorageService.getRepositoryTree.mockReturnValue(
			of({
				commitId: 'commit123',
				path: 'src',
				entries: [
					{
						name: 'index.ts',
						objectId: 'blob123',
						kind: RepositoryTreeEntryKind.REPOSITORY_TREE_ENTRY_KIND_FILE,
						sizeBytes: '24',
						path: 'src/index.ts',
						mode: '100644',
					},
				],
			})
		)

		expect(
			await client.getRepositoryTree({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				path: 'src',
			})
		).toEqual({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 24,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		expect(gitStorageService.getRepositoryTree).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				path: 'src',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.getRepositoryTree)
		).toEqual(['Bearer test-internal-token'])
	})

	test('maps text blob previews and normalizes uint64 values', async () => {
		gitStorageService.getRepositoryBlob.mockReturnValue(
			of({
				objectId: 'blob123',
				state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TEXT,
				text: 'hello',
				sizeBytes: '5',
				previewLimitBytes: '1048576',
			})
		)

		expect(
			await client.getRepositoryBlob({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			})
		).toEqual({
			objectId: 'blob123',
			sizeBytes: 5,
			preview: {
				type: 'text',
				content: 'hello',
			},
		})
		expect(gitStorageService.getRepositoryBlob).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.getRepositoryBlob)
		).toEqual(['Bearer test-internal-token'])
	})

	test('maps binary and too large blob preview states', async () => {
		gitStorageService.getRepositoryBlob.mockReturnValue(
			of({
				objectId: 'blob123',
				state: RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_BINARY,
				text: '',
				sizeBytes: 10,
				previewLimitBytes: 1_048_576,
			})
		)

		expect(
			await client.getRepositoryBlob({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			})
		).toEqual({
			objectId: 'blob123',
			sizeBytes: 10,
			preview: { type: 'binary' },
		})

		gitStorageService.getRepositoryBlob.mockReturnValue(
			of({
				objectId: 'blob123',
				state:
					RepositoryBlobPreviewState.REPOSITORY_BLOB_PREVIEW_STATE_TOO_LARGE,
				text: '',
				sizeBytes: 2_097_152,
				previewLimitBytes: '1048576',
			})
		)

		expect(
			await client.getRepositoryBlob({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			})
		).toEqual({
			objectId: 'blob123',
			sizeBytes: 2_097_152,
			preview: { type: 'tooLarge', previewLimitBytes: 1_048_576 },
		})
	})

	test('maps raw blob content bytes', async () => {
		const content = new TextEncoder().encode('hello')
		gitStorageService.getRepositoryRawBlob.mockReturnValue(
			of({
				objectId: 'blob123',
				content,
				sizeBytes: '5',
			})
		)

		expect(
			await client.getRepositoryRawBlob({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			})
		).toEqual({
			objectId: 'blob123',
			content,
			sizeBytes: 5,
		})
		expect(gitStorageService.getRepositoryRawBlob).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				objectId: 'blob123',
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.getRepositoryRawBlob)
		).toEqual(['Bearer test-internal-token'])
	})

	test('lists repository commits with identity metadata', async () => {
		expect(
			await client.listRepositoryCommits({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				limit: 20,
				trustedGpgKeys,
			})
		).toEqual({
			commits: [
				{
					...mockRepositoryCommit,
					signature: {
						state: 'unsigned',
					},
				},
			],
		})
		expect(gitStorageService.listRepositoryCommits).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				limit: 20,
				trustedGpgKeys,
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.listRepositoryCommits)
		).toEqual(['Bearer test-internal-token'])
	})

	test('lets storage use its default commit limit when omitted', async () => {
		await client.listRepositoryCommits({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: undefined,
			trustedGpgKeys,
		})

		expect(gitStorageService.listRepositoryCommits).toHaveBeenLastCalledWith(
			{
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				limit: 0,
				trustedGpgKeys,
			},
			expect.any(Metadata)
		)
		expect(
			getGitStorageAuthorization(gitStorageService.listRepositoryCommits)
		).toEqual(['Bearer test-internal-token'])
	})

	test('maps omitted grpc repeated root entries to an empty list', async () => {
		gitStorageService.getRepositoryBrowserSummary.mockReturnValue(
			of({
				isEmpty: true,
				defaultBranch: 'main',
				readme: undefined,
			})
		)

		expect(
			await client.getRepositoryBrowserSummary({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
			})
		).toEqual({
			isEmpty: true,
			defaultBranch: 'main',
			rootEntries: [],
			readme: undefined,
		})
	})

	test('maps omitted grpc scalar defaults before contract validation', async () => {
		gitStorageService.getRepositoryBrowserSummary.mockReturnValue(
			of({
				defaultBranch: 'main',
				rootEntries: [],
				readme: {
					filename: 'README.md',
					objectId: 'def456',
					content: new TextEncoder().encode('# Tessera'),
				},
			})
		)

		expect(
			await client.getRepositoryBrowserSummary({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'main',
			})
		).toEqual({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [],
			readme: {
				filename: 'README.md',
				objectId: 'def456',
				content: '# Tessera',
				isTruncated: false,
			},
		})
	})

	test('maps missing storage path to an external service error', async () => {
		gitStorageService.createRepository.mockReturnValue(of({}))

		await expect(
			client.createRepository({ repositoryId })
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test('maps missing import storage path to an external service error', async () => {
		gitStorageService.importRepository.mockReturnValue(
			of({ defaultBranch: 'main' })
		)

		await expect(
			client.importRepository({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				sourceUrl: 'https://github.com/marta/tessera',
			})
		).rejects.toBeInstanceOf(ExternalServiceError)
	})

	test('maps missing import default branch to an external service error', async () => {
		gitStorageService.importRepository.mockReturnValue(
			of({ storagePath: '/var/lib/tessera/repositories/repo.git' })
		)

		await expect(
			client.importRepository({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				sourceUrl: 'https://github.com/marta/tessera',
			})
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

function getGitStorageAuthorization(call: ReturnType<typeof vi.fn>) {
	const metadata = call.mock.lastCall?.[1]

	return metadata instanceof Metadata
		? metadata.get('authorization')
		: undefined
}

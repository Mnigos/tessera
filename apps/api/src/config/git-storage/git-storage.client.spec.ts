import type { ClientGrpc } from '@nestjs/microservices'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { of, throwError } from 'rxjs'
import {
	ExternalServiceError,
	GatewayTimeoutError,
	ServiceUnavailableError,
} from '~/shared/errors'
import {
	RepositoryBlobPreviewState,
	RepositoryTreeEntryKind,
} from './generated/tessera/git/v1/git_storage'
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
		getRepositoryTree: ReturnType<typeof vi.fn>
		getRepositoryBlob: ReturnType<typeof vi.fn>
		getRepositoryRawBlob: ReturnType<typeof vi.fn>
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
			listRepositoryCommits: vi.fn(() =>
				of({
					commits: [
						{
							sha: 'abcdef1234567890',
							shortSha: 'abcdef1',
							summary: 'Add repository browser',
							author: {
								name: 'Marta',
								email: 'marta@example.com',
								date: '2026-05-15T12:00:00Z',
							},
							committer: {
								name: 'Codex',
								email: 'codex@example.com',
								date: '2026-05-15T12:05:00Z',
							},
						},
					],
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
		expect(await client.health()).toEqual({ status: 'SERVING' })
		expect(gitStorageService.health).toHaveBeenCalledWith({})
	})

	test('creates repository storage with only repository id', async () => {
		expect(await client.createRepository({ repositoryId })).toEqual({
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		expect(gitStorageService.createRepository).toHaveBeenCalledWith({
			repositoryId,
		})
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
		expect(gitStorageService.getRepositoryBrowserSummary).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'main',
		})
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
		expect(gitStorageService.getRepositoryTree).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			path: 'src',
		})
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
		expect(gitStorageService.getRepositoryBlob).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			objectId: 'blob123',
		})
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
		expect(gitStorageService.getRepositoryRawBlob).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			objectId: 'blob123',
		})
	})

	test('lists repository commits with identity metadata', async () => {
		expect(
			await client.listRepositoryCommits({
				repositoryId,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				ref: 'main',
				limit: 20,
			})
		).toEqual({
			commits: [
				{
					sha: 'abcdef1234567890',
					shortSha: 'abcdef1',
					summary: 'Add repository browser',
					author: {
						name: 'Marta',
						email: 'marta@example.com',
						date: '2026-05-15T12:00:00Z',
					},
					committer: {
						name: 'Codex',
						email: 'codex@example.com',
						date: '2026-05-15T12:05:00Z',
					},
				},
			],
		})
		expect(gitStorageService.listRepositoryCommits).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: 20,
		})
	})

	test('lets storage use its default commit limit when omitted', async () => {
		await client.listRepositoryCommits({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: undefined,
		})

		expect(gitStorageService.listRepositoryCommits).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: 0,
		})
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

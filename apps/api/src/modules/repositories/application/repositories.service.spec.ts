import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { ExternalServiceError } from '~/shared/errors'
import { mockRepositoryCommit } from '~/shared/mocks/repository-commit.mock'
import { mockUserId } from '~/shared/test-utils'
import type { RepositoryWithOwner } from '../domain/repository'
import {
	DuplicateRepositorySlugError,
	PrivateRepositoryGitReadForbiddenError,
	RepositoryBrowserInvalidRequestError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
	RepositoryStoragePathMissingError,
} from '../domain/repository.errors'
import { highlightRepositoryBlobPreview } from '../helpers/repository-blob-highlighting'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import { RepositoriesService } from './repositories.service'

vi.mock('../helpers/repository-blob-highlighting', () => ({
	highlightRepositoryBlobPreview: vi.fn(),
}))

const textEncoder = new TextEncoder()

const repository: RepositoryWithOwner = {
	id: '00000000-0000-4000-8000-000000000003' as RepositoryId,
	ownerUserId: mockUserId,
	ownerOrganizationId: null,
	ownerUser: { username: 'marta' },
	slug: 'tessera-notes' as RepositorySlug,
	name: 'Tessera Notes' as RepositoryName,
	description: 'Notes',
	visibility: 'private',
	defaultBranch: 'main',
	storagePath: null,
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

describe(RepositoriesService.name, () => {
	let moduleRef: TestingModule
	let repositoriesService: RepositoriesService
	let repositoriesRepository: RepositoriesRepository
	let gitAccessTokensService: GitAccessTokensService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoriesService,
				{
					provide: RepositoriesRepository,
					useValue: {
						create: vi.fn(),
						list: vi.fn(),
						find: vi.fn(),
						updateStoragePath: vi.fn(),
						delete: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						createRepository: vi.fn().mockResolvedValue({
							storagePath: '/var/lib/tessera/repositories/repo.git',
						}),
						getRepositoryBrowserSummary: vi.fn().mockResolvedValue({
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
						}),
						getRepositoryTree: vi.fn().mockResolvedValue({
							commitId: 'commit123',
							path: 'src',
							entries: [
								{
									name: 'index.ts',
									objectId: 'blob123',
									kind: 'file',
									sizeBytes: 17,
									path: 'src/index.ts',
									mode: '100644',
								},
							],
						}),
						getRepositoryBlob: vi.fn().mockResolvedValue({
							objectId: 'blob123',
							sizeBytes: 17,
							preview: {
								type: 'text',
								content: 'console.log("hi")',
							},
						}),
						getRepositoryRawBlob: vi.fn().mockResolvedValue({
							objectId: 'blob123',
							content: textEncoder.encode('console.log("hi")'),
							sizeBytes: 17,
						}),
						listRepositoryRefs: vi.fn().mockResolvedValue({
							branches: [
								{
									type: 'branch',
									name: 'main',
									qualifiedName: 'refs/heads/main',
									target: 'branch123',
								},
								{
									type: 'branch',
									name: 'feature/docs',
									qualifiedName: 'refs/heads/feature/docs',
									target: 'branch456',
								},
							],
							tags: [
								{
									type: 'tag',
									name: 'v1.0.0',
									qualifiedName: 'refs/tags/v1.0.0',
									target: 'tag123',
								},
							],
						}),
						listRepositoryCommits: vi.fn().mockResolvedValue({
							commits: [mockRepositoryCommit],
						}),
					},
				},
				{
					provide: GitAccessTokensService,
					useValue: {
						verify: vi.fn().mockResolvedValue({
							userId: mockUserId,
							permissions: { git: ['read', 'write'] },
						}),
					},
				},
			],
		}).compile()

		repositoriesService = moduleRef.get(RepositoriesService)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
		gitAccessTokensService = moduleRef.get(GitAccessTokensService)
		vi.mocked(highlightRepositoryBlobPreview).mockResolvedValue(undefined)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('creates a user-owned repository with a generated slug', async () => {
		const createSpy = vi
			.spyOn(repositoriesRepository, 'create')
			.mockResolvedValue(repository)
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const createRepositorySpy = vi.spyOn(gitStorageClient, 'createRepository')
		const updateStoragePathSpy = vi
			.spyOn(repositoriesRepository, 'updateStoragePath')
			.mockResolvedValue({
				...repository,
				storagePath: '/var/lib/tessera/repositories/repo.git',
			})

		expect(
			await repositoriesService.create(mockUserId, 'marta', {
				name: ' Tessera Notes ',
			})
		).toEqual({
			repository: {
				id: repository.id,
				slug: repository.slug,
				name: repository.name,
				visibility: 'private',
				description: 'Notes',
				defaultBranch: 'main',
				createdAt: repository.createdAt,
				updatedAt: repository.updatedAt,
			},
			owner: {
				username: 'marta',
			},
		})
		expect(createSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			name: 'Tessera Notes',
			slug: 'tessera-notes',
			username: 'marta',
			description: undefined,
			visibility: undefined,
		})
		expect(createRepositorySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
		})
		expect(updateStoragePathSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			username: 'marta',
		})
	})

	test('creates a user-owned repository with a custom slug', async () => {
		const createSpy = vi
			.spyOn(repositoriesRepository, 'create')
			.mockResolvedValue({
				...repository,
				slug: 'custom-notes' as RepositorySlug,
			})
		vi.spyOn(repositoriesRepository, 'updateStoragePath').mockResolvedValue({
			...repository,
			slug: 'custom-notes' as RepositorySlug,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
				slug: ' Custom Notes!! ' as RepositorySlug,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({
					slug: 'custom-notes',
				}),
			})
		)
		expect(createSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				slug: 'custom-notes',
			})
		)
	})

	test('cleans up metadata when git storage creation fails', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'createRepository'
		).mockRejectedValue(new Error('git storage failed'))
		const deleteSpy = vi.spyOn(repositoriesRepository, 'delete')

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toThrow('git storage failed')
		expect(deleteSpy).toHaveBeenCalledWith({ repositoryId: repository.id })
	})

	test('cleans up metadata when storage path persistence fails', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'updateStoragePath').mockResolvedValue(
			undefined
		)
		const deleteSpy = vi.spyOn(repositoriesRepository, 'delete')

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryCreateFailedError)
		expect(deleteSpy).toHaveBeenCalledWith({ repositoryId: repository.id })
	})

	test('maps duplicate owner slug database errors to a conflict', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue({
			code: '23505',
			constraint: 'repositories_owner_user_slug_unique',
		})

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(DuplicateRepositorySlugError)
	})

	test('maps wrapped duplicate owner slug database errors to a conflict', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue({
			cause: {
				code: '23505',
				constraint_name: 'repositories_owner_user_slug_unique',
			},
		})

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(DuplicateRepositorySlugError)
	})

	test('logs and rethrows unexpected repository metadata create failures', async () => {
		const error = new Error('database unavailable')
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue(error)
		const loggerErrorSpy = vi
			.spyOn(repositoriesService['logger'], 'error')
			.mockImplementation(() => undefined)

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBe(error)
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to create repository',
			error.stack
		)
	})

	test('logs unexpected non-error repository metadata create failures', async () => {
		vi.spyOn(repositoriesRepository, 'create').mockRejectedValue('boom')
		const loggerErrorSpy = vi
			.spyOn(repositoriesService['logger'], 'error')
			.mockImplementation(() => undefined)

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBe('boom')
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to create repository',
			undefined
		)
	})

	test('logs cleanup failures without masking the original storage error', async () => {
		const storageError = new Error('git storage failed')
		const cleanupError = new Error('cleanup failed')
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'createRepository'
		).mockRejectedValue(storageError)
		vi.spyOn(repositoriesRepository, 'delete').mockRejectedValue(cleanupError)
		const loggerErrorSpy = vi
			.spyOn(repositoriesService['logger'], 'error')
			.mockImplementation(() => undefined)

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBe(storageError)
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to cleanup repository metadata after git storage failure',
			cleanupError.stack
		)
	})

	test('logs non-error cleanup failures without masking the original storage error', async () => {
		const storageError = new Error('git storage failed')
		vi.spyOn(repositoriesRepository, 'create').mockResolvedValue(repository)
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'createRepository'
		).mockRejectedValue(storageError)
		vi.spyOn(repositoriesRepository, 'delete').mockRejectedValue('cleanup')
		const loggerErrorSpy = vi
			.spyOn(repositoriesService['logger'], 'error')
			.mockImplementation(() => undefined)

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				name: 'Tessera Notes',
			})
		).rejects.toBe(storageError)
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to cleanup repository metadata after git storage failure',
			undefined
		)
	})

	test('rejects create requests when the session has no username', async () => {
		await expect(
			repositoriesService.create(mockUserId, undefined, {
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryCreatorUsernameRequiredError)
	})

	test('lists repositories for the authenticated username', async () => {
		const listSpy = vi
			.spyOn(repositoriesRepository, 'list')
			.mockResolvedValue([repository])

		expect(await repositoriesService.list(mockUserId)).toEqual([
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({ userId: mockUserId })
	})

	test('gets an owned repository by username and repository slug', async () => {
		const findSpy = vi
			.spyOn(repositoriesRepository, 'find')
			.mockResolvedValue(repository)

		expect(
			await repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
			})
		)
		expect(findSpy).toHaveBeenCalledWith({
			userId: mockUserId,
			slug: repository.slug,
		})
	})

	test('throws when an owned repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('throws when a readable repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('gets a public repository browser summary for anonymous readers', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		expect(
			await repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repository: expect.objectContaining({ slug: repository.slug }),
			owner: { username: 'marta' },
			isEmpty: false,
			defaultBranch: 'main',
			selectedRef: {
				type: 'branch',
				name: 'main',
				qualifiedName: 'refs/heads/main',
				target: 'branch123',
			},
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'branch123',
				},
				{
					type: 'branch',
					name: 'feature/docs',
					qualifiedName: 'refs/heads/feature/docs',
					target: 'branch456',
				},
			],
			tags: [
				{
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'tag123',
				},
			],
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
		expect(findSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: repository.slug,
		})
		expect(getRepositoryBrowserSummarySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'main',
			ref: 'refs/heads/main',
		})
	})

	test('gets a private repository browser summary for the owner', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		expect(
			await repositoriesService.getBrowserSummary(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
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
			})
		)
		expect(getRepositoryBrowserSummarySpy).toHaveBeenCalled()
	})

	test('gets a repository browser summary for a selected branch', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		expect(
			await repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'feature/docs',
			})
		).toEqual(
			expect.objectContaining({
				selectedRef: {
					type: 'branch',
					name: 'feature/docs',
					qualifiedName: 'refs/heads/feature/docs',
					target: 'branch456',
				},
				branches: [
					{
						type: 'branch',
						name: 'main',
						qualifiedName: 'refs/heads/main',
						target: 'branch123',
					},
					{
						type: 'branch',
						name: 'feature/docs',
						qualifiedName: 'refs/heads/feature/docs',
						target: 'branch456',
					},
				],
				tags: [
					{
						type: 'tag',
						name: 'v1.0.0',
						qualifiedName: 'refs/tags/v1.0.0',
						target: 'tag123',
					},
				],
			})
		)
		expect(getRepositoryBrowserSummarySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'main',
			ref: 'refs/heads/feature/docs',
		})
	})

	test('gets a repository browser summary for a selected tag', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'v1.0.0',
			})
		).toEqual(
			expect.objectContaining({
				selectedRef: {
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'tag123',
				},
			})
		)
	})

	test('does not implicitly select tags that collide with a stale default branch', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			defaultBranch: 'v1.0.0',
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		expect(
			await repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				defaultBranch: 'main',
				selectedRef: undefined,
			})
		)
		expect(getRepositoryBrowserSummarySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'v1.0.0',
			ref: undefined,
		})
	})

	test('rejects browser summaries for unknown selected refs', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		await expect(
			repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'missing',
			})
		).rejects.toBeInstanceOf(RepositoryBrowserInvalidRequestError)
		expect(getRepositoryBrowserSummarySpy).not.toHaveBeenCalled()
	})

	test('gets repository refs for readable repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryRefsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryRefs'
		)

		expect(
			await repositoriesService.getRefs(undefined, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repository: expect.objectContaining({ slug: repository.slug }),
			owner: { username: 'marta' },
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'branch123',
				},
				{
					type: 'branch',
					name: 'feature/docs',
					qualifiedName: 'refs/heads/feature/docs',
					target: 'branch456',
				},
			],
			tags: [
				{
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'tag123',
				},
			],
		})
		expect(listRepositoryRefsSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
	})

	test('returns empty ref lists for empty repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'listRepositoryRefs'
		).mockResolvedValue({
			branches: [],
			tags: [],
		})

		expect(
			await repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				selectedRef: undefined,
				branches: [],
				tags: [],
			})
		)
	})

	test('hides private browser reads from non-owners before calling git storage', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		await expect(
			repositoriesService.getBrowserSummary(
				'00000000-0000-4000-8000-000000000099' as UserId,
				{
					username: 'marta',
					slug: repository.slug,
				}
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryBrowserSummarySpy).not.toHaveBeenCalled()
	})

	test('throws before calling git storage when browser summary storage path is missing', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: null,
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryBrowserSummarySpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryBrowserSummary'
		)

		await expect(
			repositoriesService.getBrowserSummary(undefined, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
		expect(getRepositoryBrowserSummarySpy).not.toHaveBeenCalled()
	})

	test('gets a public repository tree for anonymous readers', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryTreeSpy = vi.spyOn(gitStorageClient, 'getRepositoryTree')

		expect(
			await repositoriesService.getTree(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src',
			})
		).toEqual({
			repository: expect.objectContaining({ slug: repository.slug }),
			owner: { username: 'marta' },
			ref: 'main',
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 17,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		expect(getRepositoryTreeSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			path: 'src',
		})
	})

	test('gets a private repository tree for the owner', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.getTree(mockUserId, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: undefined,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
				path: 'src',
			})
		)
	})

	test('hides private tree reads from non-owners before calling git storage', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryTreeSpy = vi.spyOn(gitStorageClient, 'getRepositoryTree')

		await expect(
			repositoriesService.getTree(
				'00000000-0000-4000-8000-000000000099' as UserId,
				{
					username: 'marta',
					slug: repository.slug,
					ref: 'main',
					path: '',
				}
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryTreeSpy).not.toHaveBeenCalled()
	})

	test('throws before calling git storage when tree storage path is missing', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: null,
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryTreeSpy = vi.spyOn(gitStorageClient, 'getRepositoryTree')

		await expect(
			repositoriesService.getTree(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: '',
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
		expect(getRepositoryTreeSpy).not.toHaveBeenCalled()
	})

	test('maps missing tree storage reads to repository not found', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.NOT_FOUND,
			})
		)

		await expect(
			repositoriesService.getTree(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'missing',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('maps wrong tree object kind storage reads to repository not found', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.FAILED_PRECONDITION,
			})
		)

		await expect(
			repositoriesService.getTree(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'README.md',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('maps invalid tree storage arguments to bad request', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		await expect(
			repositoriesService.getTree(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: '../main',
				path: '',
			})
		).rejects.toBeInstanceOf(RepositoryBrowserInvalidRequestError)
	})

	test('gets public repository commit history for anonymous readers', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryCommitsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryCommits'
		)

		expect(
			await repositoriesService.getCommitHistory(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				limit: 10,
			})
		).toEqual({
			repository: expect.objectContaining({ slug: repository.slug }),
			owner: { username: 'marta' },
			ref: 'main',
			commits: [mockRepositoryCommit],
		})
		expect(listRepositoryCommitsSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: 10,
		})
	})

	test('passes omitted commit history limit through to storage', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryCommitsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryCommits'
		)

		await repositoriesService.getCommitHistory(undefined, {
			username: 'marta',
			slug: repository.slug,
			ref: 'main',
			limit: undefined,
		})

		expect(listRepositoryCommitsSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: undefined,
		})
	})

	test('hides private commit history reads from non-owners before calling git storage', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryCommitsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryCommits'
		)

		await expect(
			repositoriesService.getCommitHistory(
				'00000000-0000-4000-8000-000000000099' as UserId,
				{
					username: 'marta',
					slug: repository.slug,
					ref: 'main',
					limit: 10,
				}
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(listRepositoryCommitsSpy).not.toHaveBeenCalled()
	})

	test('throws before calling git storage when commit history storage path is missing', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: null,
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryCommitsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryCommits'
		)

		await expect(
			repositoriesService.getCommitHistory(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				limit: 10,
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
		expect(listRepositoryCommitsSpy).not.toHaveBeenCalled()
	})

	test('maps invalid commit history storage arguments to bad request', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'listRepositoryCommits'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		await expect(
			repositoriesService.getCommitHistory(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: '../main',
				limit: 10,
			})
		).rejects.toBeInstanceOf(RepositoryBrowserInvalidRequestError)
	})

	test('gets a repository blob by resolving its path through the parent tree', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryTreeSpy = vi.spyOn(gitStorageClient, 'getRepositoryTree')
		const getRepositoryBlobSpy = vi.spyOn(gitStorageClient, 'getRepositoryBlob')

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toEqual({
			repository: expect.objectContaining({ slug: repository.slug }),
			owner: { username: 'marta' },
			ref: 'main',
			path: 'src/index.ts',
			name: 'index.ts',
			objectId: 'blob123',
			sizeBytes: 17,
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
		})
		expect(getRepositoryTreeSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			path: 'src',
		})
		expect(getRepositoryBlobSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			objectId: 'blob123',
		})
		expect(highlightRepositoryBlobPreview).toHaveBeenCalledWith({
			content: 'console.log("hi")',
			path: 'src/index.ts',
		})
	})

	test('adds syntax highlighting to text blob previews when detected', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.mocked(highlightRepositoryBlobPreview).mockResolvedValue({
			language: 'typescript',
			highlighted: {
				startLine: 1,
				lines: [
					{
						number: 1,
						html: '<span style="color:#0550ae">console</span>.log("hi")',
					},
				],
			},
		})

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toMatchObject({
			preview: {
				type: 'text',
				content: 'console.log("hi")',
				language: 'typescript',
				highlighted: {
					startLine: 1,
					lines: [
						{
							number: 1,
							html: '<span style="color:#0550ae">console</span>.log("hi")',
						},
					],
				},
			},
		})
	})

	test('keeps text blob previews unchanged when language detection falls back', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toMatchObject({
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
		})
	})

	test('keeps text blob previews unchanged when highlighting fails', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.mocked(highlightRepositoryBlobPreview).mockResolvedValue(undefined)

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toMatchObject({
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
		})
	})

	test('does not enrich binary blob previews', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryBlob'
		).mockResolvedValue({
			objectId: 'blob123',
			sizeBytes: 17,
			preview: {
				type: 'binary',
			},
		})

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toMatchObject({
			preview: {
				type: 'binary',
			},
		})
		expect(highlightRepositoryBlobPreview).not.toHaveBeenCalled()
	})

	test('does not enrich too-large blob previews', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryBlob'
		).mockResolvedValue({
			objectId: 'blob123',
			sizeBytes: 2_097_152,
			preview: {
				type: 'tooLarge',
				previewLimitBytes: 1_048_576,
			},
		})

		expect(
			await repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toMatchObject({
			preview: {
				type: 'tooLarge',
				previewLimitBytes: 1_048_576,
			},
		})
		expect(highlightRepositoryBlobPreview).not.toHaveBeenCalled()
	})

	test('throws when a blob path does not resolve to a file entry', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		vi.spyOn(gitStorageClient, 'getRepositoryTree').mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'components',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src/components',
					mode: '040000',
				},
			],
		})
		const getRepositoryBlobSpy = vi.spyOn(gitStorageClient, 'getRepositoryBlob')

		await expect(
			repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/components',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryBlobSpy).not.toHaveBeenCalled()
	})

	test('maps missing blob parent tree storage reads to repository not found', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.NOT_FOUND,
			})
		)
		const getRepositoryBlobSpy = vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryBlob'
		)

		await expect(
			repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'missing.ts',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryBlobSpy).not.toHaveBeenCalled()
	})

	test('maps wrong blob object kind storage reads to repository not found', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		vi.spyOn(gitStorageClient, 'getRepositoryBlob').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.FAILED_PRECONDITION,
			})
		)

		await expect(
			repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('maps invalid blob storage arguments to bad request', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		vi.spyOn(gitStorageClient, 'getRepositoryBlob').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		await expect(
			repositoriesService.getBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).rejects.toBeInstanceOf(RepositoryBrowserInvalidRequestError)
	})

	test('returns raw text blob content after repository read authorization', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const getRepositoryTreeSpy = vi.spyOn(gitStorageClient, 'getRepositoryTree')
		const getRepositoryRawBlobSpy = vi.spyOn(
			gitStorageClient,
			'getRepositoryRawBlob'
		)

		expect(
			await repositoriesService.getRawBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).toEqual(textEncoder.encode('console.log("hi")'))
		expect(getRepositoryTreeSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			path: 'src',
		})
		expect(getRepositoryRawBlobSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			objectId: 'blob123',
		})
	})

	test('rejects unauthorized raw blob access to private repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'private',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const getRepositoryTreeSpy = vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		)

		await expect(
			repositoriesService.getRawBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/index.ts',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryTreeSpy).not.toHaveBeenCalled()
	})

	test('rejects directory raw blob paths before reading blob content', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'components',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src/components',
					mode: '040000',
				},
			],
		})
		const getRepositoryRawBlobSpy = vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryRawBlob'
		)

		await expect(
			repositoriesService.getRawBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/components',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryRawBlobSpy).not.toHaveBeenCalled()
	})

	test('rejects missing raw blob paths before reading blob content', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryTree'
		).mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [],
		})
		const getRepositoryRawBlobSpy = vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryRawBlob'
		)

		await expect(
			repositoriesService.getRawBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: 'main',
				path: 'src/missing.ts',
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(getRepositoryRawBlobSpy).not.toHaveBeenCalled()
	})

	test('maps invalid raw blob storage arguments to bad request', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(
			moduleRef.get(GitStorageClient),
			'getRepositoryRawBlob'
		).mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		await expect(
			repositoriesService.getRawBlob(undefined, {
				username: 'marta',
				slug: repository.slug,
				ref: '../main',
				path: 'src/index.ts',
			})
		).rejects.toBeInstanceOf(RepositoryBrowserInvalidRequestError)
	})

	test('authorizes git reads for public repositories with storage metadata', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: '',
		})
		expect(findSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: repository.slug,
		})
	})

	test('throws when a git read repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('forbids git reads for private repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(repository)

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(PrivateRepositoryGitReadForbiddenError)
	})

	test('throws when a public git read repository has no storage path', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: null,
		})

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
	})

	test('authorizes git writes for repository owners with storage metadata', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const verifySpy = vi.spyOn(gitAccessTokensService, 'verify')

		expect(
			await repositoriesService.authorizeGitRepositoryWrite({
				rawToken: 'tes_git_raw-secret',
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: mockUserId,
		})
		expect(verifySpy).toHaveBeenCalledWith({
			rawToken: 'tes_git_raw-secret',
			requiredPermission: 'git:write',
		})
		expect(findSpy).toHaveBeenCalledWith({
			username: 'marta',
			slug: repository.slug,
		})
	})

	test('forbids git writes for non-owners', async () => {
		vi.spyOn(gitAccessTokensService, 'verify').mockResolvedValue({
			userId: '00000000-0000-4000-8000-000000000099' as UserId,
			permissions: { git: ['read', 'write'] },
		})
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		await expect(
			repositoriesService.authorizeGitRepositoryWrite({
				rawToken: 'tes_git_raw-secret',
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitWriteForbiddenError)
	})

	test('throws when a git write repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.authorizeGitRepositoryWrite({
				rawToken: 'tes_git_raw-secret',
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('throws when a writable repository has no storage path', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: null,
		})

		await expect(
			repositoriesService.authorizeGitRepositoryWrite({
				rawToken: 'tes_git_raw-secret',
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
	})
})

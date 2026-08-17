import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { ChecksReadService } from '@modules/checks'
import { GitAccessTokensService } from '@modules/git-access-tokens'
import { GitHubSyncQueue } from '@modules/github-sync/infrastructure/github-sync.queue'
import { GpgPublicKeysService } from '@modules/gpg-public-keys'
import { SshPublicKeysService } from '@modules/ssh-public-keys'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryExternalSourceId } from '@repo/db'
import type {
	OrganizationId,
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
	RepositoryAdminForbiddenError,
	RepositoryBrowserInvalidRequestError,
	RepositoryCreateFailedError,
	RepositoryCreatorUsernameRequiredError,
	RepositoryGitHubMirrorCutoverSyncInProgressError,
	RepositoryGitHubMirrorCutoverUnavailableError,
	RepositoryGitHubMirrorSyncUnavailableError,
	RepositoryGitHubSourceOfTruthWriteForbiddenError,
	RepositoryGitWriteForbiddenError,
	RepositoryNotFoundError,
	RepositoryStoragePathMissingError,
} from '../domain/repository.errors'
import type { RepositorySyncHealthFacts } from '../domain/repository-sync-health'
import { highlightRepositoryBlobPreview } from '../helpers/repository-blob-highlighting'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import { RepositorySyncHealthRepository } from '../infrastructure/repository-sync-health.repository'
import { RepositoriesService } from './repositories.service'
import { RepositoryPermissionsService } from './repository-permissions.service'

vi.mock('../helpers/repository-blob-highlighting', () => ({
	highlightRepositoryBlobPreview: vi.fn(),
}))

/** A converged mirror, which is what cutover asks the read model for. */
function healthyFacts(
	overrides: Partial<RepositorySyncHealthFacts> = {}
): RepositorySyncHealthFacts {
	return {
		syncStatus: 'succeeded',
		syncProgress: undefined,
		lastSyncSucceededAt: new Date(),
		pendingDeliveryCount: 0,
		retryCount24h: 0,
		terminalCount24h: 0,
		completedCount24h: 1,
		latestAttemptStatus: 'succeeded',
		...overrides,
	}
}

const textEncoder = new TextEncoder()
const trustedGpgKey = {
	keyId: '0123456789ABCDEF',
	fingerprint: '0123456789ABCDEF0123456789ABCDEF01234567',
	publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
}

const repository: RepositoryWithOwner = {
	id: '00000000-0000-4000-8000-000000000003' as RepositoryId,
	ownerUserId: mockUserId,
	ownerOrganizationId: null,
	owner: { kind: 'user', handle: 'marta' },
	slug: 'tessera-notes' as RepositorySlug,
	name: 'Tessera Notes' as RepositoryName,
	description: 'Notes',
	visibility: 'private',
	defaultBranch: 'main',
	storagePath: null,
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

/** A repository GitHub owns, with a last run the source row calls successful. */
function mirroredGitHubRepository(): RepositoryWithOwner {
	return {
		...repository,
		storagePath: '/var/lib/tessera/repositories/repo.git',
		externalSource: {
			id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
			repositoryId: repository.id,
			provider: 'github',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			syncProgress: null,
			lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
			lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
			lastSyncFailedAt: null,
			nextSyncAt: new Date('2026-05-12T01:01:00Z'),
			syncFailureCount: 0,
			syncFailureReason: null,
			cutoverActorUserId: null,
			cutoverAt: null,
			cutoverFromMirrorMode: null,
			githubPushBackEnabled: false,
			githubPushBackStatus: 'idle',
			githubPushBackStartedAt: null,
			githubPushBackSucceededAt: null,
			githubPushBackFailedAt: null,
			githubPushBackFailureReason: null,
			createdAt: new Date('2026-05-12T00:00:00Z'),
			updatedAt: new Date('2026-05-12T00:00:00Z'),
		},
	}
}

const collaboratorUserId = '00000000-0000-4000-8000-000000000042' as UserId

describe(RepositoriesService.name, () => {
	let moduleRef: TestingModule
	let repositoriesService: RepositoriesService
	let repositoriesRepository: RepositoriesRepository
	let gpgPublicKeysService: GpgPublicKeysService
	let sshPublicKeysService: SshPublicKeysService
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
						findOwner: vi.fn(),
						updateStoragePath: vi.fn(),
						completeImportedGitHubRepository: vi.fn(),
						upsertGitHubExternalSource: vi.fn(),
						findGitHubMirrorEnablement: vi.fn(),
						enableGitHubMirror: vi.fn(),
						cutoverGitHubMirror: vi.fn(),
						findCollaboratorRole: vi.fn(),
						findOrganizationMemberRole: vi.fn(),
						countOpenPullRequestsAndCollaborators: vi.fn().mockResolvedValue({
							openPullRequestCount: 3,
							collaboratorCount: 2,
						}),
						delete: vi.fn(),
					},
				},
				RepositoryPermissionsService,
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
							commitCount: 12,
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
						pushRepositoryMirror: vi.fn(),
					},
				},
				{
					provide: GpgPublicKeysService,
					useValue: {
						list: vi.fn().mockResolvedValue([
							{
								...trustedGpgKey,
								id: '00000000-0000-4000-8000-000000000091',
								title: 'Marta',
								publicKey: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
								identities: [],
								emails: [],
								keyCreatedAt: new Date('2026-05-01T00:00:00Z'),
								keyExpiresAt: undefined,
								isRevoked: false,
								lastUsedAt: undefined,
								createdAt: new Date('2026-05-01T00:00:00Z'),
								updatedAt: new Date('2026-05-01T00:00:00Z'),
							},
						]),
					},
				},
				{
					provide: SshPublicKeysService,
					useValue: {
						findOwnerByFingerprint: vi.fn().mockResolvedValue(mockUserId),
						authenticateByFingerprint: vi.fn().mockResolvedValue(mockUserId),
					},
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn((key: string) => {
							if (key === 'GITHUB_APP_INSTALL_URL')
								return 'https://github.com/apps/tessera/installations/new'
							if (key === 'GITHUB_MIRROR_SYNC_INTERVAL_MINUTES') return 60
							if (key === 'GIT_HTTP_BASE_URL') return 'http://git.localhost'
							if (key === 'GIT_SSH_BASE_URL')
								return 'ssh://git@git.localhost:2222'

							return undefined
						}),
					},
				},
				{
					provide: GitAccessTokensService,
					useValue: { verify: vi.fn() },
				},
				{
					provide: ChecksReadService,
					useValue: { listSummaries: vi.fn().mockResolvedValue(new Map()) },
				},
				{
					provide: RepositorySyncHealthRepository,
					useValue: { findFacts: vi.fn().mockResolvedValue(healthyFacts()) },
				},
				{ provide: GitHubSyncQueue, useValue: { enqueue: vi.fn() } },
			],
		}).compile()

		repositoriesService = moduleRef.get(RepositoriesService)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
		gpgPublicKeysService = moduleRef.get(GpgPublicKeysService)
		sshPublicKeysService = moduleRef.get(SshPublicKeysService)
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
				owner: { kind: 'user' },
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
				externalSource: { mode: 'none' },
				cloneUrls: {
					authority: 'tessera',
					https: 'http://git.localhost/marta/tessera-notes.git',
					ssh: 'ssh://git@git.localhost:2222/marta/tessera-notes.git',
				},
				createdAt: repository.createdAt,
				updatedAt: repository.updatedAt,
			},
			owner: {
				kind: 'user',
				handle: 'marta',
				username: 'marta',
			},
		})
		expect(createSpy).toHaveBeenCalledWith({
			owner: { ownerUserId: mockUserId, ownerOrganizationId: null },
			name: 'Tessera Notes',
			slug: 'tessera-notes',
			description: undefined,
			visibility: undefined,
		})
		expect(createRepositorySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
		})
		expect(updateStoragePathSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
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
				owner: { kind: 'user' },
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

	test.each([
		'owner',
		'admin',
	] as const)('creates an organization-owned repository for an organization %s', async role => {
		const organizationId =
			'00000000-0000-4000-8000-000000000050' as OrganizationId
		const organizationRepository = {
			...repository,
			ownerUserId: null,
			ownerOrganizationId: organizationId,
			owner: { kind: 'organization' as const, handle: 'tessera' },
		}
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(role)
		const createSpy = vi
			.spyOn(repositoriesRepository, 'create')
			.mockResolvedValue(organizationRepository)
		vi.spyOn(repositoriesRepository, 'updateStoragePath').mockResolvedValue({
			...organizationRepository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.create(mockUserId, 'marta', {
				owner: { kind: 'organization', organizationId },
				name: 'Tessera Notes',
			})
		).toEqual(
			expect.objectContaining({
				owner: {
					kind: 'organization',
					handle: 'tessera',
					username: 'tessera',
				},
			})
		)
		expect(createSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				owner: { ownerUserId: null, ownerOrganizationId: organizationId },
			})
		)
	})

	test.each([
		['plain member', 'member'],
		['non-member or unknown organization', undefined],
	] as const)('refuses an organization-owned repository for a %s', async (_label, role) => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(role)

		await expect(
			repositoriesService.create(mockUserId, 'marta', {
				owner: {
					kind: 'organization',
					organizationId:
						'00000000-0000-4000-8000-000000000050' as OrganizationId,
				},
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryAdminForbiddenError)
		expect(repositoriesRepository.create).not.toHaveBeenCalled()
	})

	test('rejects a user-owned repository when the session has no username', async () => {
		await expect(
			repositoriesService.create(mockUserId, undefined, {
				owner: { kind: 'user' },
				name: 'Tessera Notes',
			})
		).rejects.toBeInstanceOf(RepositoryCreatorUsernameRequiredError)
		expect(repositoriesRepository.create).not.toHaveBeenCalled()
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
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
				owner: { kind: 'user' },
				name: 'Tessera Notes',
			})
		).rejects.toBe(storageError)
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to cleanup repository metadata after git storage failure',
			undefined
		)
	})

	test('lists repositories under a handle the viewer administers', async () => {
		vi.spyOn(repositoriesRepository, 'findOwner').mockResolvedValue({
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
		})
		const listSpy = vi
			.spyOn(repositoriesRepository, 'list')
			.mockResolvedValue([repository])

		expect(
			await repositoriesService.list(mockUserId, { username: 'marta' })
		).toEqual([
			expect.objectContaining({
				repository: expect.objectContaining({ slug: repository.slug }),
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({
			ownerUserId: mockUserId,
			ownerOrganizationId: null,
		})
	})

	test.each([
		'owner',
		'admin',
	] as const)('lists repositories for an organization %s', async role => {
		const organizationId =
			'00000000-0000-4000-8000-000000000050' as OrganizationId
		const organizationRepository = {
			...repository,
			ownerUserId: null,
			ownerOrganizationId: organizationId,
			owner: { kind: 'organization' as const, handle: 'tessera' },
		}
		vi.spyOn(repositoriesRepository, 'findOwner').mockResolvedValue({
			ownerUserId: null,
			ownerOrganizationId: organizationId,
		})
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(role)
		const listSpy = vi
			.spyOn(repositoriesRepository, 'list')
			.mockResolvedValue([organizationRepository])

		expect(
			await repositoriesService.list(mockUserId, { username: 'tessera' })
		).toEqual([
			expect.objectContaining({
				owner: {
					kind: 'organization',
					handle: 'tessera',
					username: 'tessera',
				},
			}),
		])
		expect(listSpy).toHaveBeenCalledWith({
			ownerUserId: null,
			ownerOrganizationId: organizationId,
		})
	})

	test('hides repositories under a handle the viewer does not administer', async () => {
		vi.spyOn(repositoriesRepository, 'findOwner').mockResolvedValue({
			ownerUserId: null,
			ownerOrganizationId:
				'00000000-0000-4000-8000-000000000050' as OrganizationId,
		})
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue('member')

		await expect(
			repositoriesService.list(mockUserId, { username: 'tessera' })
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('reports an unknown handle as a missing repository', async () => {
		vi.spyOn(repositoriesRepository, 'findOwner').mockResolvedValue(undefined)

		await expect(
			repositoriesService.list(mockUserId, { username: 'nobody' })
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('initializes imported GitHub external source metadata', async () => {
		const completedAt = new Date('2026-05-12T00:01:00Z')
		const startedAt = new Date('2026-05-12T00:00:00Z')
		const upsertGitHubExternalSourceSpy = vi.spyOn(
			repositoriesRepository,
			'upsertGitHubExternalSource'
		)

		await repositoriesService.initializeImportedGitHubExternalSource({
			repositoryId: repository.id,
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'tessera',
			fullName: 'marta/tessera',
			sourceUrl: 'https://github.com/marta/tessera',
			sourceDefaultBranch: 'main',
			startedAt,
			completedAt,
		})

		expect(upsertGitHubExternalSourceSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'tessera',
			fullName: 'marta/tessera',
			sourceUrl: 'https://github.com/marta/tessera',
			sourceDefaultBranch: 'main',
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: startedAt,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			syncFailureReason: undefined,
		})
	})

	test('completes imported GitHub repository storage and external source metadata', async () => {
		const completedAt = new Date('2026-05-12T00:01:00Z')
		const startedAt = new Date('2026-05-12T00:00:00Z')
		const completeImportedGitHubRepositorySpy = vi
			.spyOn(repositoriesRepository, 'completeImportedGitHubRepository')
			.mockResolvedValue(repository)

		expect(
			await repositoriesService.completeImportedGitHubRepository({
				repositoryId: repository.id,
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'trunk',
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'tessera',
				fullName: 'marta/tessera',
				sourceUrl: 'https://github.com/marta/tessera',
				sourceDefaultBranch: 'main',
				startedAt,
				completedAt,
			})
		).toBe(repository)
		expect(completeImportedGitHubRepositorySpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'tessera',
			fullName: 'marta/tessera',
			sourceUrl: 'https://github.com/marta/tessera',
			sourceDefaultBranch: 'main',
			mirrorMode: 'imported',
			syncStatus: 'succeeded',
			lastSyncStartedAt: startedAt,
			lastSyncSucceededAt: completedAt,
			lastSyncFailedAt: undefined,
			syncFailureReason: undefined,
		})
	})

	test('gets a repository by owner handle and repository slug', async () => {
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
			handle: 'marta',
			slug: repository.slug,
		})
	})

	test('re-authorizes repository administration from the service input', async () => {
		const victimUserId = '00000000-0000-4000-8000-000000000099' as UserId
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			ownerUserId: victimUserId,
			owner: { kind: 'user', handle: 'victim' },
		})

		await expect(
			repositoriesService.get(mockUserId, {
				username: 'victim',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
		expect(findSpy).toHaveBeenCalledWith({
			handle: 'victim',
			slug: repository.slug,
		})
	})

	test('throws when a repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.get(mockUserId, {
				username: 'marta',
				slug: 'missing' as RepositorySlug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('enables automatic GitHub mirroring when an installation is linked', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: createGitHubExternalSource({ mirrorMode: 'imported' }),
		})
		vi.spyOn(
			repositoriesRepository,
			'findGitHubMirrorEnablement'
		).mockResolvedValue({
			installationId: '00000000-0000-4000-8000-000000000099',
			mirrorMode: 'imported',
		})
		const syncRequest = {
			repositoryId: repository.id,
			authorityGeneration: 1,
			requestedSyncVersion: 3,
		}
		const enableGitHubMirrorSpy = vi
			.spyOn(repositoriesRepository, 'enableGitHubMirror')
			.mockResolvedValue(syncRequest)
		const gitHubSyncQueue = moduleRef.get(GitHubSyncQueue)

		expect(
			await repositoriesService.enableGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({ status: 'enabled' })
		expect(enableGitHubMirrorSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
		})
		expect(gitHubSyncQueue.enqueue).toHaveBeenCalledWith(syncRequest)
	})

	test('returns the GitHub App installation URL when installation is required', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: createGitHubExternalSource({ mirrorMode: 'imported' }),
		})
		vi.spyOn(
			repositoriesRepository,
			'findGitHubMirrorEnablement'
		).mockResolvedValue({ mirrorMode: 'imported' })

		expect(
			await repositoriesService.enableGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			status: 'installation_required',
			installUrl: 'https://github.com/apps/tessera/installations/new',
		})
		expect(repositoriesRepository.enableGitHubMirror).not.toHaveBeenCalled()
	})

	test('cuts over a succeeded GitHub mirror to Tessera source', async () => {
		const actorUserId = '00000000-0000-4000-8000-000000000101' as UserId
		const cutoverAt = new Date('2026-05-12T00:02:00Z')
		const mirroredRepository = {
			...repository,
			ownerUserId: null,
			ownerOrganizationId:
				'00000000-0000-4000-8000-000000000050' as OrganizationId,
			owner: { kind: 'organization' as const, handle: 'tessera' },
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: {
				id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
				repositoryId: repository.id,
				provider: 'github' as const,
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'github_to_tessera' as const,
				syncStatus: 'succeeded' as const,
				syncProgress: null,
				lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
				lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
				lastSyncFailedAt: null,
				nextSyncAt: new Date('2026-05-12T01:01:00Z'),
				syncFailureCount: 0,
				syncFailureReason: null,
				cutoverActorUserId: null,
				cutoverAt: null,
				cutoverFromMirrorMode: null,
				githubPushBackEnabled: false,
				githubPushBackStatus: 'idle' as const,
				githubPushBackStartedAt: null,
				githubPushBackSucceededAt: null,
				githubPushBackFailedAt: null,
				githubPushBackFailureReason: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
			},
		}
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredRepository
		)
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue('admin')
		const cutoverGitHubMirrorSpy = vi
			.spyOn(repositoriesRepository, 'cutoverGitHubMirror')
			.mockResolvedValue({
				...mirroredRepository,
				externalSource: {
					...mirroredRepository.externalSource,
					mirrorMode: 'tessera_source',
					nextSyncAt: null,
					cutoverActorUserId: actorUserId,
					cutoverAt,
					cutoverFromMirrorMode: 'github_to_tessera',
				},
			})

		expect(
			await repositoriesService.cutoverGitHubMirror(actorUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				repository: expect.objectContaining({
					externalSource: expect.objectContaining({
						mode: 'tessera_source',
						nextSyncAt: undefined,
						cutoverActorUserId: actorUserId,
						cutoverAt,
						githubPushBackEnabled: false,
						githubPushBackStatus: 'idle',
					}),
				}),
			})
		)
		expect(repositoriesRepository.find).toHaveBeenCalledWith({
			handle: 'marta',
			slug: repository.slug,
		})
		expect(cutoverGitHubMirrorSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			actorUserId,
			cutoverAt: expect.any(Date),
		})
	})

	test('rejects cutover when the last run finalized incompletely', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		const cutoverGitHubMirrorSpy = vi.spyOn(
			repositoriesRepository,
			'cutoverGitHubMirror'
		)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(healthyFacts({ latestAttemptStatus: 'partial' }))

		// The source row says `succeeded`, which is exactly the case the old gate
		// let through: switching authority here would keep whatever the partial run
		// never reconciled out of Tessera permanently.
		await expect(
			repositoriesService.cutoverGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorCutoverUnavailableError)
		expect(cutoverGitHubMirrorSpy).not.toHaveBeenCalled()
	})

	test('rejects cutover while deliveries are still unprocessed', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(healthyFacts({ pendingDeliveryCount: 2 }))

		await expect(
			repositoriesService.cutoverGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorCutoverUnavailableError)
	})

	test('reports derived sync health for a mirrored repository', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(
			healthyFacts({
				retryCount24h: 3,
				terminalCount24h: 1,
				completedCount24h: 4,
			})
		)

		expect(
			await repositoriesService.getGitHubSyncHealth(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			syncHealth: expect.objectContaining({
				state: 'healthy',
				retryCount24h: 3,
				failureRate24h: 0.25,
			}),
		})
	})

	test('reports no sync health for a repository with no external source', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(repository)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(undefined)

		expect(
			await repositoriesService.getGitHubSyncHealth(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({ syncHealth: undefined })
	})

	test('offers the GitHub App install page when access has to be granted again', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(
			healthyFacts({
				syncStatus: 'blocked',
				syncFailureCode: 'missing_installation',
				latestAttemptStatus: 'blocked',
			})
		)

		expect(
			await repositoriesService.getGitHubReauthorization(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			reauthorizationRequired: true,
			installUrl: 'https://github.com/apps/tessera/installations/new',
		})
	})

	test('refuses reauthorization guidance it cannot make actionable', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		vi.spyOn(
			moduleRef.get(RepositorySyncHealthRepository),
			'findFacts'
		).mockResolvedValue(
			healthyFacts({
				syncStatus: 'blocked',
				syncFailureCode: 'missing_installation',
				latestAttemptStatus: 'blocked',
			})
		)
		vi.spyOn(moduleRef.get(EnvService), 'get').mockReturnValue(undefined)

		// Telling someone their mirror needs reauthorizing without saying where to
		// do it leaves them stuck; the deployment is misconfigured.
		await expect(
			repositoriesService.getGitHubReauthorization(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorSyncUnavailableError)
	})

	test('never requests synchronization while answering a reauthorization question', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			mirroredGitHubRepository()
		)
		const enableGitHubMirrorSpy = vi.spyOn(
			repositoriesRepository,
			'enableGitHubMirror'
		)

		expect(
			await repositoriesService.getGitHubReauthorization(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({ reauthorizationRequired: false })
		expect(enableGitHubMirrorSpy).not.toHaveBeenCalled()
	})

	test('rejects cutover while GitHub mirror sync is running', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: {
				id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
				repositoryId: repository.id,
				provider: 'github' as const,
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'github_to_tessera' as const,
				syncStatus: 'running' as const,
				syncProgress: null,
				lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
				lastSyncSucceededAt: null,
				lastSyncFailedAt: null,
				nextSyncAt: null,
				syncFailureCount: 0,
				syncFailureReason: null,
				cutoverActorUserId: null,
				cutoverAt: null,
				cutoverFromMirrorMode: null,
				githubPushBackEnabled: false,
				githubPushBackStatus: 'idle' as const,
				githubPushBackStartedAt: null,
				githubPushBackSucceededAt: null,
				githubPushBackFailedAt: null,
				githubPushBackFailureReason: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
			},
		})

		await expect(
			repositoriesService.cutoverGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorCutoverSyncInProgressError)
		expect(repositoriesRepository.cutoverGitHubMirror).not.toHaveBeenCalled()
	})

	test('rejects cutover when latest GitHub mirror sync failed', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: {
				id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
				repositoryId: repository.id,
				provider: 'github' as const,
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'github_to_tessera' as const,
				syncStatus: 'failed' as const,
				syncProgress: null,
				lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
				lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
				lastSyncFailedAt: new Date('2026-05-12T00:02:00Z'),
				nextSyncAt: null,
				syncFailureCount: 1,
				syncFailureReason: 'clone failed',
				cutoverActorUserId: null,
				cutoverAt: null,
				cutoverFromMirrorMode: null,
				githubPushBackEnabled: false,
				githubPushBackStatus: 'idle' as const,
				githubPushBackStartedAt: null,
				githubPushBackSucceededAt: null,
				githubPushBackFailedAt: null,
				githubPushBackFailureReason: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
			},
		})

		await expect(
			repositoriesService.cutoverGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorCutoverUnavailableError)
		expect(repositoriesRepository.cutoverGitHubMirror).not.toHaveBeenCalled()
	})

	test('rejects cutover for imported GitHub repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: {
				id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
				repositoryId: repository.id,
				provider: 'github' as const,
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'imported' as const,
				syncStatus: 'succeeded' as const,
				syncProgress: null,
				lastSyncStartedAt: null,
				lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
				lastSyncFailedAt: null,
				nextSyncAt: null,
				syncFailureCount: 0,
				syncFailureReason: null,
				cutoverActorUserId: null,
				cutoverAt: null,
				cutoverFromMirrorMode: null,
				githubPushBackEnabled: false,
				githubPushBackStatus: 'idle' as const,
				githubPushBackStartedAt: null,
				githubPushBackSucceededAt: null,
				githubPushBackFailedAt: null,
				githubPushBackFailureReason: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
			},
		})

		await expect(
			repositoriesService.cutoverGitHubMirror(mockUserId, {
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryGitHubMirrorCutoverUnavailableError)
		expect(repositoriesRepository.cutoverGitHubMirror).not.toHaveBeenCalled()
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
			owner: { kind: 'user', handle: 'marta', username: 'marta' },
			viewerRole: 'read',
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
			commitCount: 12,
			openPullRequestCount: 3,
			collaboratorCount: 2,
		})
		expect(findSpy).toHaveBeenCalledWith({
			handle: 'marta',
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
			owner: { kind: 'user', handle: 'marta', username: 'marta' },
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
			trustedGpgKeys: [trustedGpgKey],
		})
		expect(gpgPublicKeysService.list).toHaveBeenCalledWith(
			repository.ownerUserId
		)
	})

	test('does not trust user GPG keys for organization-owned repository refs', async () => {
		const organizationRepository: RepositoryWithOwner = {
			...repository,
			ownerUserId: null,
			ownerOrganizationId:
				'00000000-0000-4000-8000-000000000050' as OrganizationId,
			owner: { kind: 'organization', handle: 'tessera' },
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		}
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(
			organizationRepository
		)
		const gitStorageClient = moduleRef.get(GitStorageClient)
		const listRepositoryRefsSpy = vi.spyOn(
			gitStorageClient,
			'listRepositoryRefs'
		)

		expect(
			await repositoriesService.getRefs(undefined, {
				username: 'tessera',
				slug: repository.slug,
			})
		).toEqual(
			expect.objectContaining({
				owner: {
					kind: 'organization',
					handle: 'tessera',
					username: 'tessera',
				},
			})
		)
		expect(listRepositoryRefsSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedGpgKeys: [],
		})
		expect(gpgPublicKeysService.list).not.toHaveBeenCalled()
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
			owner: { kind: 'user', handle: 'marta', username: 'marta' },
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
			owner: { kind: 'user', handle: 'marta', username: 'marta' },
			ref: 'main',
			commits: [mockRepositoryCommit],
		})
		expect(listRepositoryCommitsSpy).toHaveBeenCalledWith({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			ref: 'main',
			limit: 10,
			trustedGpgKeys: [trustedGpgKey],
		})
		expect(gpgPublicKeysService.list).toHaveBeenCalledWith(
			repository.ownerUserId
		)
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
			trustedGpgKeys: [trustedGpgKey],
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
		expect(gpgPublicKeysService.list).not.toHaveBeenCalled()
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
			owner: { kind: 'user', handle: 'marta', username: 'marta' },
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
			objectId: 'blob123',
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
			handle: 'marta',
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

	test('masks private repositories as not found for anonymous git reads', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(repository)

		await expect(
			repositoriesService.authorizeGitRepositoryRead({
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('authorizes private git reads for collaborators with a read token', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'read'
		)
		const verifySpy = vi
			.spyOn(gitAccessTokensService, 'verify')
			.mockResolvedValue({
				userId: collaboratorUserId,
				permissions: { git: ['read'] },
			})

		expect(
			await repositoriesService.authorizeGitRepositoryRead(
				{ username: 'marta', slug: repository.slug },
				'tes_git_raw-secret'
			)
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: collaboratorUserId,
		})
		expect(verifySpy).toHaveBeenCalledWith({
			rawToken: 'tes_git_raw-secret',
			requiredPermission: 'git:read',
		})
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

	test('authorizes git writes for repository owners', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				mockUserId
			)
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: mockUserId,
		})
		expect(findSpy).toHaveBeenCalledWith({
			handle: 'marta',
			slug: repository.slug,
		})
	})

	test('authorizes git writes for write collaborators', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'write'
		)

		expect(
			await repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				collaboratorUserId
			)
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: collaboratorUserId,
		})
	})

	test('forbids git writes for read-only collaborators', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'read'
		)

		await expect(
			repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				collaboratorUserId
			)
		).rejects.toBeInstanceOf(RepositoryGitWriteForbiddenError)
	})

	test('masks private repositories as not found for git writes without access', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		await expect(
			repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				collaboratorUserId
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('allows git writes for imported-only GitHub repositories', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: createGitHubExternalSource({ mirrorMode: 'imported' }),
		})

		expect(
			await repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				mockUserId
			)
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: mockUserId,
		})
	})

	test('denies git writes when GitHub is source of truth', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			externalSource: createGitHubExternalSource({
				mirrorMode: 'github_to_tessera',
			}),
		})

		const authorizeWrite = repositoriesService.authorizeGitRepositoryWrite(
			{ username: 'marta', slug: repository.slug },
			mockUserId
		)

		await expect(authorizeWrite).rejects.toBeInstanceOf(
			RepositoryGitHubSourceOfTruthWriteForbiddenError
		)
	})

	test('throws when a git write repository is unknown', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue(undefined)

		await expect(
			repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: 'missing' as RepositorySlug },
				mockUserId
			)
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})

	test('throws when a writable repository has no storage path', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			storagePath: null,
		})

		await expect(
			repositoriesService.authorizeGitRepositoryWrite(
				{ username: 'marta', slug: repository.slug },
				mockUserId
			)
		).rejects.toBeInstanceOf(RepositoryStoragePathMissingError)
	})

	test('authorizes ssh git reads for public repositories with known keys', async () => {
		const findSpy = vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'public',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		const findOwnerByFingerprintSpy = vi.spyOn(
			sshPublicKeysService,
			'findOwnerByFingerprint'
		)

		expect(
			await repositoriesService.authorizeSshGitRepositoryRead({
				fingerprint: 'SHA256:abc',
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: mockUserId,
		})
		expect(findOwnerByFingerprintSpy).toHaveBeenCalledWith('SHA256:abc')
		expect(findSpy).toHaveBeenCalledWith({
			handle: 'marta',
			slug: repository.slug,
		})
	})

	test('authenticates known ssh keys before command authorization', async () => {
		const authenticateByFingerprintSpy = vi.spyOn(
			sshPublicKeysService,
			'authenticateByFingerprint'
		)

		expect(
			await repositoriesService.authenticateSshKey({
				fingerprint: 'SHA256:abc',
				username: 'git',
			})
		).toEqual({
			trustedUser: mockUserId,
		})
		expect(authenticateByFingerprintSpy).toHaveBeenCalledWith('SHA256:abc')
		expect(sshPublicKeysService.findOwnerByFingerprint).not.toHaveBeenCalled()
	})

	test('authorizes ssh git reads for private repositories owned by the key owner', async () => {
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'private',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		expect(
			await repositoriesService.authorizeSshGitRepositoryRead({
				fingerprint: 'SHA256:abc',
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: mockUserId,
		})
	})

	test('authorizes ssh git reads for private repositories shared with collaborators', async () => {
		vi.spyOn(sshPublicKeysService, 'findOwnerByFingerprint').mockResolvedValue(
			collaboratorUserId
		)
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'private',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'read'
		)

		expect(
			await repositoriesService.authorizeSshGitRepositoryRead({
				fingerprint: 'SHA256:abc',
				username: 'marta',
				slug: repository.slug,
			})
		).toEqual({
			repositoryId: repository.id,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			trustedUser: collaboratorUserId,
		})
	})

	test('masks private repositories as not found for ssh reads without access', async () => {
		vi.spyOn(sshPublicKeysService, 'findOwnerByFingerprint').mockResolvedValue(
			'00000000-0000-4000-8000-000000000099' as UserId
		)
		vi.spyOn(repositoriesRepository, 'find').mockResolvedValue({
			...repository,
			visibility: 'private',
			storagePath: '/var/lib/tessera/repositories/repo.git',
		})

		await expect(
			repositoriesService.authorizeSshGitRepositoryRead({
				fingerprint: 'SHA256:abc',
				username: 'marta',
				slug: repository.slug,
			})
		).rejects.toBeInstanceOf(RepositoryNotFoundError)
	})
})

function createGitHubExternalSource(overrides = {}) {
	return {
		id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
		repositoryId: repository.id,
		provider: 'github' as const,
		externalRepositoryId: 123n,
		ownerLogin: 'marta',
		name: 'notes',
		fullName: 'marta/notes',
		sourceUrl: 'https://github.com/marta/notes',
		sourceDefaultBranch: 'main',
		mirrorMode: 'tessera_source' as const,
		syncStatus: 'succeeded' as const,
		syncProgress: null,
		lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
		lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
		lastSyncFailedAt: null,
		nextSyncAt: null,
		syncFailureCount: 0,
		syncFailureReason: null,
		cutoverActorUserId: mockUserId,
		cutoverAt: new Date('2026-05-12T00:01:00Z'),
		cutoverFromMirrorMode: 'github_to_tessera' as const,
		githubPushBackEnabled: false,
		githubPushBackStatus: 'idle' as const,
		githubPushBackStartedAt: null,
		githubPushBackSucceededAt: null,
		githubPushBackFailedAt: null,
		githubPushBackFailureReason: null,
		createdAt: new Date('2026-05-12T00:00:00Z'),
		updatedAt: new Date('2026-05-12T00:00:00Z'),
		...overrides,
	}
}

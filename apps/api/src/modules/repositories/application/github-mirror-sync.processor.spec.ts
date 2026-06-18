import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryExternalSourceId } from '@repo/db'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import type { Job } from 'bullmq'
import { mockUserId } from '~/shared/test-utils'
import type { GitHubMirrorSyncRepositoryJobData } from '../infrastructure/github-mirror-sync.queue'
import {
	GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
	GitHubMirrorSyncQueue,
} from '../infrastructure/github-mirror-sync.queue'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import { GitHubMirrorSyncProcessor } from './github-mirror-sync.processor'

const repositoryId = '00000000-0000-4000-8000-000000000030' as RepositoryId
const externalSourceId =
	'00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId
const startedAt = new Date('2026-05-12T00:00:00Z')
const repository = {
	id: repositoryId,
	ownerUserId: mockUserId,
	ownerOrganizationId: null,
	ownerUser: { username: 'marta' },
	slug: 'notes' as RepositorySlug,
	name: 'Notes' as RepositoryName,
	description: null,
	visibility: 'private' as const,
	defaultBranch: 'main',
	storagePath: '/var/lib/tessera/repositories/repo.git',
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
	externalSource: {
		id: externalSourceId,
		repositoryId,
		provider: 'github' as const,
		externalRepositoryId: 123n,
		ownerLogin: 'marta',
		name: 'notes',
		fullName: 'marta/notes',
		sourceUrl: 'https://github.com/marta/notes',
		sourceDefaultBranch: 'main',
		mirrorMode: 'github_to_tessera' as const,
		syncStatus: 'running' as const,
		lastSyncStartedAt: startedAt,
		lastSyncSucceededAt: null,
		lastSyncFailedAt: null,
		nextSyncAt: new Date('2026-05-12T00:15:00Z'),
		syncFailureCount: 0,
		syncFailureReason: null,
		createdAt: new Date('2026-05-12T00:00:00Z'),
		updatedAt: new Date('2026-05-12T00:00:00Z'),
	},
}
const job = {
	attemptsMade: 0,
	data: { repositoryId, requesterUserId: mockUserId },
	opts: { attempts: 1 },
} as Job<GitHubMirrorSyncRepositoryJobData>

describe(GitHubMirrorSyncProcessor.name, () => {
	let moduleRef: TestingModule
	let processor: GitHubMirrorSyncProcessor
	let repositoriesRepository: RepositoriesRepository
	let gitStorageClient: GitStorageClient & {
		importRepository: ReturnType<typeof vi.fn>
	}
	let githubMirrorSyncQueue: GitHubMirrorSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubMirrorSyncProcessor,
				{
					provide: RepositoriesRepository,
					useValue: {
						markGitHubMirrorSyncRunning: vi.fn(),
						findGitHubAccount: vi.fn(),
						markGitHubMirrorSyncSucceeded: vi.fn(),
						markGitHubMirrorSyncFailed: vi.fn(),
						claimDueGitHubMirrorSyncRepositories: vi.fn(),
					},
				},
				{
					provide: GitStorageClient,
					useValue: {
						importRepository: vi.fn(),
					},
				},
				{
					provide: GitHubMirrorSyncQueue,
					useValue: {
						enqueueRepositorySync: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn((key: string) => {
							if (key === 'GITHUB_MIRROR_SYNC_INTERVAL_MINUTES') return 60
							if (key === 'GITHUB_MIRROR_SYNC_BATCH_SIZE') return 25

							return undefined
						}),
					},
				},
			],
		}).compile()

		processor = moduleRef.get(GitHubMirrorSyncProcessor)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
		gitStorageClient = moduleRef.get(GitStorageClient)
		githubMirrorSyncQueue = moduleRef.get(GitHubMirrorSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	test('syncs a GitHub mirror and marks it succeeded', async () => {
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
		})
		const importRepositorySpy = vi
			.spyOn(gitStorageClient, 'importRepository')
			.mockResolvedValue({
				storagePath: '/var/lib/tessera/repositories/repo.git',
				defaultBranch: 'trunk',
			})
		const markGitHubMirrorSyncSucceededSpy = vi
			.spyOn(repositoriesRepository, 'markGitHubMirrorSyncSucceeded')
			.mockResolvedValue(repository)

		await processor.process(job)

		expect(importRepositorySpy).toHaveBeenCalledWith({
			repositoryId,
			storagePath: '/var/lib/tessera/repositories/repo.git',
			sourceUrl: 'https://github.com/marta/notes',
			accessToken: 'github-token',
			defaultBranchHint: 'main',
		})
		expect(markGitHubMirrorSyncSucceededSpy).toHaveBeenCalledWith({
			repositoryId,
			username: 'marta',
			storagePath: '/var/lib/tessera/repositories/repo.git',
			defaultBranch: 'trunk',
			externalRepositoryId: 123n,
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncStartedAt: startedAt,
			lastSyncSucceededAt: expect.any(Date),
			lastSyncFailedAt: null,
			nextSyncAt: expect.any(Date),
			syncFailureCount: 0,
			syncFailureReason: null,
		})
	})

	test('marks sync auth-blocked when requester GitHub token is missing', async () => {
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: null,
		})
		const markGitHubMirrorSyncFailedSpy = vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncFailed'
		)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await processor.process(job)

		expect(gitStorageClient.importRepository).not.toHaveBeenCalled()
		expect(markGitHubMirrorSyncFailedSpy).toHaveBeenCalledWith({
			repositoryId,
			failedAt: expect.any(Date),
			failureReason: 'missing GitHub access token',
			nextSyncAt: null,
		})
	})

	test('marks sync failed when running metadata has no start time', async () => {
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue({
			...repository,
			externalSource: {
				...repository.externalSource,
				lastSyncStartedAt: null,
			},
		})
		vi.spyOn(repositoriesRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
		})
		const markGitHubMirrorSyncFailedSpy = vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncFailed'
		)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await expect(processor.process(job)).rejects.toThrow(
			'missing GitHub mirror sync start time'
		)

		expect(gitStorageClient.importRepository).not.toHaveBeenCalled()
		expect(markGitHubMirrorSyncFailedSpy).toHaveBeenCalledWith({
			repositoryId,
			failedAt: expect.any(Date),
			failureReason: 'missing GitHub mirror sync start time',
			nextSyncAt: expect.any(Date),
			syncFailureCount: 1,
		})
	})

	test('rethrows sync failures before the final retry attempt', async () => {
		const retryingJob = {
			...job,
			attemptsMade: 0,
			opts: { attempts: 2 },
		} as Job<GitHubMirrorSyncRepositoryJobData>
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockRejectedValue(
			new Error('fetch failed')
		)
		const markGitHubMirrorSyncFailedSpy = vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncFailed'
		)
		const warnSpy = vi
			.spyOn(Logger.prototype, 'warn')
			.mockImplementation(() => undefined)

		await expect(processor.process(retryingJob)).rejects.toThrow('fetch failed')
		expect(markGitHubMirrorSyncFailedSpy).not.toHaveBeenCalled()
		expect(warnSpy).toHaveBeenCalledWith('GitHub mirror sync failed; retrying')
	})

	test('marks sync failed after the final retry attempt', async () => {
		const finalJob = {
			...job,
			attemptsMade: 1,
			opts: { attempts: 2 },
		} as Job<GitHubMirrorSyncRepositoryJobData>
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue(repository)
		vi.spyOn(repositoriesRepository, 'findGitHubAccount').mockResolvedValue({
			accessToken: 'github-token',
		})
		vi.spyOn(gitStorageClient, 'importRepository').mockRejectedValue(
			new Error('fetch failed')
		)
		const markGitHubMirrorSyncFailedSpy = vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncFailed'
		)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await expect(processor.process(finalJob)).rejects.toThrow('fetch failed')

		expect(markGitHubMirrorSyncFailedSpy).toHaveBeenCalledWith({
			repositoryId,
			failedAt: expect.any(Date),
			failureReason: 'fetch failed',
			nextSyncAt: expect.any(Date),
			syncFailureCount: 1,
		})
	})

	test('does nothing when no pending sync can be claimed', async () => {
		vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncRunning'
		).mockResolvedValue(undefined)

		await processor.process(job)

		expect(repositoriesRepository.findGitHubAccount).not.toHaveBeenCalled()
		expect(gitStorageClient.importRepository).not.toHaveBeenCalled()
	})

	test('dispatches due repository syncs and continues when one enqueue fails', async () => {
		const otherRepositoryId =
			'00000000-0000-4000-8000-000000000031' as RepositoryId
		vi.spyOn(
			repositoriesRepository,
			'claimDueGitHubMirrorSyncRepositories'
		).mockResolvedValue([
			repository,
			{
				...repository,
				id: otherRepositoryId,
				ownerUserId: '00000000-0000-4000-8000-000000000032' as UserId,
			},
		])
		vi.spyOn(
			githubMirrorSyncQueue,
			'enqueueRepositorySync'
		).mockRejectedValueOnce(new Error('redis unavailable'))
		const markGitHubMirrorSyncFailedSpy = vi.spyOn(
			repositoriesRepository,
			'markGitHubMirrorSyncFailed'
		)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await processor.process({
			name: GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
			data: { type: 'dispatcher' },
			attemptsMade: 0,
			opts: {},
		} as Job)

		expect(
			repositoriesRepository.claimDueGitHubMirrorSyncRepositories
		).toHaveBeenCalledWith({
			limit: 25,
			now: expect.any(Date),
		})
		expect(githubMirrorSyncQueue.enqueueRepositorySync).toHaveBeenCalledWith({
			repositoryId,
			requesterUserId: mockUserId,
		})
		expect(githubMirrorSyncQueue.enqueueRepositorySync).toHaveBeenCalledWith({
			repositoryId: otherRepositoryId,
			requesterUserId: '00000000-0000-4000-8000-000000000032',
		})
		expect(markGitHubMirrorSyncFailedSpy).toHaveBeenCalledWith({
			repositoryId,
			failedAt: expect.any(Date),
			failureReason:
				'Scheduled GitHub mirror sync could not be queued. Please retry.',
			nextSyncAt: expect.any(Date),
			syncFailureCount: 1,
		})
	})
})

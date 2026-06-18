import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
	GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
	GITHUB_MIRROR_SYNC_SCHEDULER_ID,
	GitHubMirrorSyncJobQueue,
	GitHubMirrorSyncQueue,
} from './github-mirror-sync.queue'

const repositoryId = '00000000-0000-4000-8000-000000000030' as RepositoryId

interface QueueMock {
	add: ReturnType<typeof vi.fn>
	getJob: ReturnType<typeof vi.fn>
	getJobScheduler: ReturnType<typeof vi.fn>
	remove: ReturnType<typeof vi.fn>
	upsertJobScheduler: ReturnType<typeof vi.fn>
}

describe(GitHubMirrorSyncQueue.name, () => {
	let moduleRef: TestingModule
	let queue: QueueMock
	let githubMirrorSyncQueue: GitHubMirrorSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubMirrorSyncQueue,
				{
					provide: GitHubMirrorSyncJobQueue,
					useValue: {
						add: vi.fn(),
						getJob: vi.fn(),
						getJobScheduler: vi.fn(),
						remove: vi.fn(),
						upsertJobScheduler: vi.fn(),
					},
				},
			],
		}).compile()

		queue = moduleRef.get(GitHubMirrorSyncJobQueue)
		githubMirrorSyncQueue = moduleRef.get(GitHubMirrorSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('enqueues repository syncs by repository id', async () => {
		await githubMirrorSyncQueue.enqueueRepositorySync({
			repositoryId,
			requesterUserId: mockUserId,
		})

		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
			{ repositoryId, requesterUserId: mockUserId },
			{
				attempts: 3,
				backoff: {
					type: 'exponential',
					delay: 10_000,
				},
				jobId: repositoryId,
				removeOnComplete: true,
				removeOnFail: true,
			}
		)
	})

	test('keeps an existing queued repository sync', async () => {
		queue.getJob.mockResolvedValue({
			getState: vi.fn().mockResolvedValue('waiting'),
		})

		await githubMirrorSyncQueue.enqueueRepositorySync({
			repositoryId,
			requesterUserId: mockUserId,
		})

		expect(queue.add).not.toHaveBeenCalled()
		expect(queue.remove).not.toHaveBeenCalled()
	})

	test('rejects an existing active repository sync', async () => {
		queue.getJob.mockResolvedValue({
			getState: vi.fn().mockResolvedValue('active'),
		})

		await expect(
			githubMirrorSyncQueue.enqueueRepositorySync({
				repositoryId,
				requesterUserId: mockUserId,
			})
		).rejects.toThrow(
			`GitHub mirror sync job is already active for repository ${repositoryId}`
		)
		expect(queue.add).not.toHaveBeenCalled()
		expect(queue.remove).not.toHaveBeenCalled()
	})

	test('replaces an existing finished repository sync', async () => {
		queue.getJob.mockResolvedValue({
			getState: vi.fn().mockResolvedValue('failed'),
		})
		queue.remove.mockResolvedValue(1)

		await githubMirrorSyncQueue.enqueueRepositorySync({
			repositoryId,
			requesterUserId: mockUserId,
		})

		expect(queue.remove).toHaveBeenCalledWith(repositoryId, {
			removeChildren: true,
		})
		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
			{ repositoryId, requesterUserId: mockUserId },
			{
				attempts: 3,
				backoff: {
					type: 'exponential',
					delay: 10_000,
				},
				jobId: repositoryId,
				removeOnComplete: true,
				removeOnFail: true,
			}
		)
	})

	test('re-enqueues when a stale repository sync disappears before removal', async () => {
		queue.getJob
			.mockResolvedValueOnce({
				getState: vi.fn().mockResolvedValue('failed'),
			})
			.mockResolvedValueOnce(null)
		queue.remove.mockResolvedValue(0)

		await githubMirrorSyncQueue.enqueueRepositorySync({
			repositoryId,
			requesterUserId: mockUserId,
		})

		expect(queue.remove).toHaveBeenCalledWith(repositoryId, {
			removeChildren: true,
		})
		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
			{ repositoryId, requesterUserId: mockUserId },
			expect.objectContaining({ jobId: repositoryId })
		)
	})

	test('registers dispatcher scheduler', async () => {
		await githubMirrorSyncQueue.scheduleDispatcher('*/30 * * * *')

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			GITHUB_MIRROR_SYNC_SCHEDULER_ID,
			{ pattern: '*/30 * * * *' },
			{
				name: GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
				data: { type: 'dispatcher' },
			}
		)
	})

	test('reads dispatcher scheduler', async () => {
		queue.getJobScheduler.mockResolvedValue({
			key: GITHUB_MIRROR_SYNC_SCHEDULER_ID,
			name: GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
			next: new Date('2026-05-12T00:30:00Z').getTime(),
		})

		expect(await githubMirrorSyncQueue.getDispatcherSchedule()).toEqual({
			key: GITHUB_MIRROR_SYNC_SCHEDULER_ID,
			name: GITHUB_MIRROR_SYNC_DISPATCHER_JOB,
			next: new Date('2026-05-12T00:30:00Z').getTime(),
		})
		expect(queue.getJobScheduler).toHaveBeenCalledWith(
			GITHUB_MIRROR_SYNC_SCHEDULER_ID
		)
	})
})

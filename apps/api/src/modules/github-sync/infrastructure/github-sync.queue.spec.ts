import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_REPOSITORY_JOB,
	GITHUB_SYNC_SCHEDULER_ID,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from './github-sync.queue'

const request = {
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	authorityGeneration: 3,
	requestedSyncVersion: 9,
}

describe(GitHubSyncQueue.name, () => {
	let moduleRef: TestingModule
	let queue: GitHubSyncJobQueue
	let service: GitHubSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncQueue,
				{
					provide: GitHubSyncJobQueue,
					useValue: {
						add: vi.fn(),
						getJob: vi.fn(),
						upsertJobScheduler: vi.fn(),
						getJobScheduler: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(GitHubSyncQueue)
		queue = moduleRef.get(GitHubSyncJobQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('uses generation and version in idempotent repository job ids', async () => {
		await service.enqueue(request)

		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_SYNC_REPOSITORY_JOB,
			request,
			expect.objectContaining({
				jobId: `${request.repositoryId}-3-9`,
				attempts: 5,
			})
		)
	})

	// BullMQ reserves the colon for its own key namespacing and rejects a custom
	// job id containing one, so this queue used to fail at the enqueue boundary.
	test('builds a job id BullMQ accepts', async () => {
		await service.enqueue(request)

		expect(vi.mocked(queue.add).mock.calls[0]?.[2]?.jobId).not.toContain(':')
	})

	test('collapses every waker of the same version onto one job', async () => {
		await service.enqueue(request)
		await service.enqueue(request)
		await service.enqueue({ ...request, requestedSyncVersion: 10 })

		expect(vi.mocked(queue.add).mock.calls.map(call => call[2]?.jobId)).toEqual(
			[
				`${request.repositoryId}-3-9`,
				`${request.repositoryId}-3-9`,
				`${request.repositoryId}-3-10`,
			]
		)
	})

	// Discarding every failed job left nothing to inspect while a repository was
	// failing; PostgreSQL keeps the durable history, Redis keeps a bounded copy.
	test('retains a bounded number of failed jobs', async () => {
		await service.enqueue(request)

		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_SYNC_REPOSITORY_JOB,
			request,
			expect.objectContaining({ removeOnFail: { count: 200 } })
		)
	})

	// A retained failed job keeps its custom id, and BullMQ ignores an add whose
	// id already exists. Without this the deferral of a rate-limited version
	// would be permanent: PostgreSQL keeps asking, the queue keeps refusing.
	test('clears a retained failed job so its version can be woken again', async () => {
		const remove = vi.fn()
		vi.spyOn(queue, 'getJob').mockResolvedValue({
			isFailed: vi.fn().mockResolvedValue(true),
			remove,
		} as never)

		await service.enqueue(request)

		expect(remove).toHaveBeenCalledOnce()
		expect(queue.add).toHaveBeenCalledOnce()
	})

	test('leaves a job that has not failed alone', async () => {
		const remove = vi.fn()
		vi.spyOn(queue, 'getJob').mockResolvedValue({
			isFailed: vi.fn().mockResolvedValue(false),
			remove,
		} as never)

		await service.enqueue(request)

		expect(remove).not.toHaveBeenCalled()
	})

	test('still enqueues when a retained job refuses removal', async () => {
		vi.spyOn(queue, 'getJob').mockResolvedValue({
			isFailed: vi.fn().mockResolvedValue(true),
			remove: vi.fn().mockRejectedValue(new Error('job is locked')),
		} as never)

		await service.enqueue(request)

		expect(queue.add).toHaveBeenCalledOnce()
	})

	test('upserts and reads the singleton dispatcher schedule', async () => {
		vi.spyOn(queue, 'getJobScheduler').mockResolvedValue({
			key: GITHUB_SYNC_SCHEDULER_ID,
			name: GITHUB_SYNC_DISPATCHER_JOB,
			next: 123,
		})

		await service.scheduleDispatcher('*/5 * * * *')

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			GITHUB_SYNC_SCHEDULER_ID,
			{ pattern: '*/5 * * * *' },
			{
				name: GITHUB_SYNC_DISPATCHER_JOB,
				data: { type: 'dispatcher' },
			}
		)
		expect(await service.getDispatcherSchedule()).toEqual(
			expect.objectContaining({ next: 123 })
		)
	})
})

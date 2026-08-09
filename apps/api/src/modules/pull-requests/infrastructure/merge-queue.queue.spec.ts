import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import {
	MERGE_QUEUE_RECONCILER_JOB,
	MERGE_QUEUE_RECONCILER_SCHEDULER_ID,
	MERGE_QUEUE_WAKEUP_JOB,
	MergeQueue,
	MergeQueueJobQueue,
} from './merge-queue.queue'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId

describe(MergeQueue.name, () => {
	let moduleRef: TestingModule
	let queue: MergeQueueJobQueue
	let service: MergeQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueue,
				{
					provide: MergeQueueJobQueue,
					useValue: {
						add: vi.fn(),
						upsertJobScheduler: vi.fn(),
						getJobScheduler: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(MergeQueue)
		queue = moduleRef.get(MergeQueueJobQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	// Every waker of one committed change asks for the same job, so a reconciler
	// re-sending a wakeup that was already delivered adds nothing.
	test('keys a wakeup by the repository and the version it was requested at', async () => {
		await service.enqueueWakeup({ repositoryId, requestedVersion: 7 })

		expect(queue.add).toHaveBeenCalledWith(
			MERGE_QUEUE_WAKEUP_JOB,
			{ repositoryId, requestedVersion: 7 },
			expect.objectContaining({
				jobId: `${repositoryId}-7`,
				attempts: 5,
				removeOnComplete: true,
				removeOnFail: true,
			})
		)
	})

	// BullMQ reserves the colon for its own key namespacing and rejects a custom
	// job id containing one. It surfaces as a refused wakeup, which leaves the
	// queue waiting for the reconciler's next cron tick instead of running now.
	test('keys a wakeup with an id BullMQ will accept', async () => {
		await service.enqueueWakeup({ repositoryId, requestedVersion: 7 })

		const [, , options] = vi.mocked(queue.add).mock.calls[0] ?? []

		expect(options?.jobId).toBeTruthy()
		expect(options?.jobId).not.toContain(':')
	})

	test('upserts and reads the singleton reconciler schedule', async () => {
		vi.spyOn(queue, 'getJobScheduler').mockResolvedValue({
			key: MERGE_QUEUE_RECONCILER_SCHEDULER_ID,
			name: MERGE_QUEUE_RECONCILER_JOB,
			next: 123,
		})

		await service.scheduleReconciler('*/1 * * * *')

		expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
			MERGE_QUEUE_RECONCILER_SCHEDULER_ID,
			{ pattern: '*/1 * * * *' },
			{ name: MERGE_QUEUE_RECONCILER_JOB, data: { type: 'reconciler' } }
		)
		expect(await service.getReconcilerSchedule()).toEqual(
			expect.objectContaining({ next: 123 })
		)
	})
})

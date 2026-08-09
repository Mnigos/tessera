import { EnvService } from '@config/env'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { MergeQueue } from '../infrastructure/merge-queue.queue'
import { MergeQueueScheduler } from './merge-queue.scheduler'

describe(MergeQueueScheduler.name, () => {
	let moduleRef: TestingModule
	let scheduler: MergeQueueScheduler
	let queue: MergeQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueueScheduler,
				{
					provide: MergeQueue,
					useValue: {
						scheduleReconciler: vi.fn(),
						getReconcilerSchedule: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: { get: vi.fn(() => '*/1 * * * *') },
				},
			],
		}).compile()

		scheduler = moduleRef.get(MergeQueueScheduler)
		queue = moduleRef.get(MergeQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('registers the reconciler schedule and logs its next run', async () => {
		vi.spyOn(queue, 'getReconcilerSchedule').mockResolvedValue({
			next: new Date('2026-07-29T12:05:00Z').getTime(),
		})
		const loggerLogSpy = vi
			.spyOn(Logger.prototype, 'log')
			.mockImplementation(() => undefined)

		await scheduler.onModuleInit()

		expect(queue.scheduleReconciler).toHaveBeenCalledWith('*/1 * * * *')
		expect(loggerLogSpy).toHaveBeenCalledWith(
			'Merge queue reconciler will run at 2026-07-29T12:05:00.000Z'
		)
	})

	// A queue whose reconciler could not be registered still merges everything it
	// is woken for, so refusing to boot over it would be the worse failure.
	test('keeps bootstrap alive when the schedule cannot be registered', async () => {
		vi.spyOn(queue, 'scheduleReconciler').mockRejectedValue(
			new Error('Redis unavailable')
		)
		const loggerErrorSpy = vi
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined)
		const scheduleSpy = vi.spyOn(queue, 'getReconcilerSchedule')

		await expect(scheduler.onModuleInit()).resolves.toBeUndefined()

		expect(loggerErrorSpy).toHaveBeenCalled()
		expect(scheduleSpy).not.toHaveBeenCalled()
	})
})

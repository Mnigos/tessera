import { EnvService } from '@config/env'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncScheduler } from './github-sync.scheduler'

describe(GitHubSyncScheduler.name, () => {
	let moduleRef: TestingModule
	let scheduler: GitHubSyncScheduler
	let queue: GitHubSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncScheduler,
				{
					provide: GitHubSyncQueue,
					useValue: {
						scheduleDispatcher: vi.fn(),
						getDispatcherSchedule: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: { get: vi.fn(() => '*/5 * * * *') },
				},
			],
		}).compile()

		scheduler = moduleRef.get(GitHubSyncScheduler)
		queue = moduleRef.get(GitHubSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('registers the dispatcher schedule and logs its next run', async () => {
		vi.spyOn(queue, 'getDispatcherSchedule').mockResolvedValue({
			next: new Date('2026-07-29T12:05:00Z').getTime(),
		})
		const loggerLogSpy = vi
			.spyOn(Logger.prototype, 'log')
			.mockImplementation(() => undefined)

		await scheduler.onModuleInit()

		expect(queue.scheduleDispatcher).toHaveBeenCalledWith('*/5 * * * *')
		expect(queue.getDispatcherSchedule).toHaveBeenCalledOnce()
		expect(loggerLogSpy).toHaveBeenCalledWith(
			'GitHub sync dispatcher cron will run at 2026-07-29T12:05:00.000Z'
		)
	})

	test('keeps bootstrap alive when dispatcher registration fails', async () => {
		vi.spyOn(queue, 'scheduleDispatcher').mockRejectedValue(
			new Error('Redis unavailable')
		)
		const loggerErrorSpy = vi
			.spyOn(Logger.prototype, 'error')
			.mockImplementation(() => undefined)

		await scheduler.onModuleInit()

		expect(queue.getDispatcherSchedule).not.toHaveBeenCalled()
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'Failed to register GitHub sync dispatcher schedule',
			expect.stringContaining('Redis unavailable')
		)
	})
})

import { EnvService } from '@config/env'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { GitHubMirrorSyncQueue } from '../infrastructure/github-mirror-sync.queue'
import { GitHubMirrorSyncScheduler } from './github-mirror-sync.scheduler'

describe(GitHubMirrorSyncScheduler.name, () => {
	let moduleRef: TestingModule
	let scheduler: GitHubMirrorSyncScheduler
	let githubMirrorSyncQueue: GitHubMirrorSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubMirrorSyncScheduler,
				{
					provide: GitHubMirrorSyncQueue,
					useValue: {
						scheduleDispatcher: vi.fn(),
						getDispatcherSchedule: vi.fn(),
					},
				},
				{
					provide: EnvService,
					useValue: {
						get: vi.fn().mockReturnValue('*/15 * * * *'),
					},
				},
			],
		}).compile()

		scheduler = moduleRef.get(GitHubMirrorSyncScheduler)
		githubMirrorSyncQueue = moduleRef.get(GitHubMirrorSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	test('registers dispatcher schedule on module init', async () => {
		vi.spyOn(githubMirrorSyncQueue, 'getDispatcherSchedule').mockResolvedValue({
			next: new Date('2026-05-12T00:15:00Z').getTime(),
		})
		const loggerLogSpy = vi
			.spyOn(Logger.prototype, 'log')
			.mockImplementation(() => undefined)

		await scheduler.onModuleInit()

		expect(githubMirrorSyncQueue.scheduleDispatcher).toHaveBeenCalledWith(
			'*/15 * * * *'
		)
		expect(githubMirrorSyncQueue.getDispatcherSchedule).toHaveBeenCalled()
		expect(loggerLogSpy).toHaveBeenCalledWith(
			'GitHub mirror sync dispatcher cron will run at 2026-05-12T00:15:00.000Z'
		)
	})
})

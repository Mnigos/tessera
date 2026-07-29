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
				jobId: `${request.repositoryId}:3:9`,
				attempts: 5,
				removeOnFail: true,
			})
		)
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

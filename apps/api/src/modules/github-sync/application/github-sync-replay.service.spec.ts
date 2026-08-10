import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubWebhookDeliveryId } from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncRepository } from '../infrastructure/github-sync.repository'
import { GitHubSyncReplayService } from './github-sync-replay.service'

const deliveryId =
	'00000000-0000-4000-8000-000000000111' as GitHubWebhookDeliveryId
const request = {
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	authorityGeneration: 2,
	requestedSyncVersion: 8,
	trigger: 'replay' as const,
	replayDeliveryId: deliveryId,
}

describe(GitHubSyncReplayService.name, () => {
	let moduleRef: TestingModule
	let service: GitHubSyncReplayService
	let repository: GitHubSyncRepository
	let queue: GitHubSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncReplayService,
				{
					provide: GitHubSyncRepository,
					useValue: { replayWebhookDelivery: vi.fn() },
				},
				{ provide: GitHubSyncQueue, useValue: { enqueue: vi.fn() } },
			],
		}).compile()

		service = moduleRef.get(GitHubSyncReplayService)
		repository = moduleRef.get(GitHubSyncRepository)
		queue = moduleRef.get(GitHubSyncQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('re-arms a delivery onto the ordinary reconciliation path', async () => {
		vi.spyOn(repository, 'replayWebhookDelivery').mockResolvedValue(request)

		expect(await service.replayDelivery(deliveryId)).toBeTruthy()
		// Replay enqueues the same repository job every other trigger produces, so
		// there is no second projection path that could duplicate anything.
		expect(queue.enqueue).toHaveBeenCalledWith(request)
	})

	test('refuses a delivery the current authority cannot replay', async () => {
		vi.spyOn(repository, 'replayWebhookDelivery').mockResolvedValue(undefined)

		expect(await service.replayDelivery(deliveryId)).toBeFalsy()
		expect(queue.enqueue).not.toHaveBeenCalled()
	})

	test('collapses a replay storm onto one job per version', async () => {
		vi.spyOn(repository, 'replayWebhookDelivery')
			.mockResolvedValueOnce(request)
			.mockResolvedValueOnce({ ...request, requestedSyncVersion: 9 })
			.mockResolvedValueOnce({ ...request, requestedSyncVersion: 10 })

		await Promise.all([
			service.replayDelivery(deliveryId),
			service.replayDelivery(deliveryId),
			service.replayDelivery(deliveryId),
		])

		// Each replay advances the version, so BullMQ's job id keeps them distinct
		// while the repository lease still runs them one at a time.
		expect(
			vi
				.mocked(queue.enqueue)
				.mock.calls.map(([enqueued]) => enqueued.requestedSyncVersion)
		).toEqual([8, 9, 10])
	})
})

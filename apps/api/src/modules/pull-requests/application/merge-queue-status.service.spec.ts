import { Test, type TestingModule } from '@nestjs/testing'
import type {
	MergeQueueEntryId,
	PullRequestId,
	RepositoryId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	type MergeQueueEntryReadModel,
	MergeQueueRepository,
} from '../infrastructure/merge-queue.repository'
import { MergeQueueStatusService } from './merge-queue-status.service'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const pullRequestId = '00000000-0000-4000-8000-000000000044' as PullRequestId
const entryId = '00000000-0000-4000-8000-000000000066' as MergeQueueEntryId
const createdAt = new Date('2026-07-11T00:00:00Z')
const entry: MergeQueueEntryReadModel = {
	id: entryId,
	pullRequestId,
	position: 4,
	state: 'queued',
	blockingReasons: null,
	enqueuedByUserId: mockUserId,
	enqueuedAt: createdAt,
	stateChangedAt: createdAt,
}

describe(MergeQueueStatusService.name, () => {
	let moduleRef: TestingModule
	let service: MergeQueueStatusService
	let mergeQueueRepository: MergeQueueRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				MergeQueueStatusService,
				{
					provide: MergeQueueRepository,
					useValue: {
						findActiveEntry: vi.fn(),
						countRunnableEntries: vi.fn(),
					},
				},
			],
		}).compile()

		service = moduleRef.get(MergeQueueStatusService)
		mergeQueueRepository = moduleRef.get(MergeQueueRepository)

		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(0)
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(
			undefined
		)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	// The place shown is how many runnable entries sit ahead, because stored
	// positions are allocation order and are never renumbered.
	test('reports a place counted from the runnable entries ahead of it', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue(entry)
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries')
			.mockResolvedValueOnce(5)
			.mockResolvedValueOnce(2)

		expect(
			await service.getStatus({ pullRequestId, repositoryId })
		).toMatchObject({
			entry: { position: 3 },
			runnableCount: 5,
		})
	})

	// A paused entry has no place: nothing is waiting behind it.
	test('gives a paused entry no place in the queue', async () => {
		vi.spyOn(mergeQueueRepository, 'findActiveEntry').mockResolvedValue({
			...entry,
			state: 'paused',
			blockingReasons: [{ code: 'threads_unresolved', count: 2 }],
		})

		const status = await service.getStatus({ pullRequestId, repositoryId })

		expect(status.entry?.position).toBeUndefined()
		expect(status.entry?.blockingReasons).toEqual([
			{ code: 'threads_unresolved', count: 2 },
		])
	})

	test('reports a pull request that is not queued at all', async () => {
		vi.spyOn(mergeQueueRepository, 'countRunnableEntries').mockResolvedValue(3)

		expect(await service.getStatus({ pullRequestId, repositoryId })).toEqual({
			runnableCount: 3,
		})
	})
})

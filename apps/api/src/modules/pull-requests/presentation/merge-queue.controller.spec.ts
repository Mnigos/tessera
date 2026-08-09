import {
	RepositoriesService,
	RepositoryWriteGuard,
} from '@modules/repositories'
import { Test, type TestingModule } from '@nestjs/testing'
import type { MergeQueueStatus } from '@repo/contracts'
import type { RepositorySlug } from '@repo/domain'
import { createMockSession, mockUserId } from '~/shared/test-utils'
import { MergeQueueService } from '../application/merge-queue.service'
import { MergeQueueController } from './merge-queue.controller'

const session = createMockSession()
const input = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	number: 1,
}
const status: MergeQueueStatus = { runnableCount: 2 }

describe(MergeQueueController.name, () => {
	let moduleRef: TestingModule
	let controller: MergeQueueController
	let service: MergeQueueService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			controllers: [MergeQueueController],
			providers: [
				{
					provide: RepositoryWriteGuard,
					useValue: { canActivate: vi.fn() },
				},
				{
					provide: RepositoriesService,
					useValue: { assertViewerRepositoryWriteAccess: vi.fn() },
				},
				{
					provide: MergeQueueService,
					useValue: { join: vi.fn(), leave: vi.fn(), retry: vi.fn() },
				},
			],
		}).compile()

		controller = moduleRef.get(MergeQueueController)
		service = moduleRef.get(MergeQueueService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test.each([
		{ action: 'joinMergeQueue' as const, serviceAction: 'join' as const },
		{ action: 'leaveMergeQueue' as const, serviceAction: 'leave' as const },
		{
			action: 'retryMergeQueueEntry' as const,
			serviceAction: 'retry' as const,
		},
	])('delegates $action to the queue as the session user', async ({
		action,
		serviceAction,
	}) => {
		const serviceSpy = vi
			.spyOn(service, serviceAction)
			.mockResolvedValue(status)
		const procedure = controller[action](session)

		expect(
			await procedure['~orpc'].handler({
				input,
				context: {},
				path: ['pullRequests', action],
				procedure,
				lastEventId: undefined,
				errors: {},
			})
		).toEqual(status)
		expect(serviceSpy).toHaveBeenCalledWith(mockUserId, input)
	})
})

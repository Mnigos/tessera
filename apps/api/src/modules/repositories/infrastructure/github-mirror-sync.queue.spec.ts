import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import type { Queue } from 'bullmq'
import { mockUserId } from '~/shared/test-utils'
import {
	GITHUB_MIRROR_SYNC_REPOSITORY_JOB,
	GitHubMirrorSyncQueue,
} from './github-mirror-sync.queue'

const repositoryId = '00000000-0000-4000-8000-000000000030' as RepositoryId

describe(GitHubMirrorSyncQueue.name, () => {
	let moduleRef: TestingModule
	let queue: Queue
	let githubMirrorSyncQueue: GitHubMirrorSyncQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubMirrorSyncQueue,
				{
					provide: 'BullQueue_github-mirror-sync',
					useValue: {
						add: vi.fn(),
					},
				},
			],
		}).compile()

		queue = moduleRef.get('BullQueue_github-mirror-sync')
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
})

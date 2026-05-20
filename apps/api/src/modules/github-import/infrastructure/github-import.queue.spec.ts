import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryImportId } from '@repo/db'
import type { Queue } from 'bullmq'
import {
	GITHUB_IMPORT_REPOSITORY_JOB,
	GitHubImportQueue,
} from './github-import.queue'

const importId = '00000000-0000-4000-8000-000000000029' as RepositoryImportId

describe(GitHubImportQueue.name, () => {
	let moduleRef: TestingModule
	let queue: Queue
	let githubImportQueue: GitHubImportQueue

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubImportQueue,
				{
					provide: 'BullQueue_github-import',
					useValue: {
						add: vi.fn(),
					},
				},
			],
		}).compile()

		queue = moduleRef.get('BullQueue_github-import')
		githubImportQueue = moduleRef.get(GitHubImportQueue)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('enqueues repository imports with a patient retry window', async () => {
		await githubImportQueue.enqueueRepositoryImport(importId)

		expect(queue.add).toHaveBeenCalledWith(
			GITHUB_IMPORT_REPOSITORY_JOB,
			{ importId },
			{
				attempts: 10,
				backoff: {
					type: 'exponential',
					delay: 10_000,
				},
				jobId: importId,
			}
		)
	})
})

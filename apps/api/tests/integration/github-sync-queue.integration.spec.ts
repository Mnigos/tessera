import { randomUUID } from 'node:crypto'
import {
	GITHUB_SYNC_QUEUE_NAME,
	GITHUB_SYNC_REPOSITORY_JOB,
	GitHubSyncJobQueue,
	GitHubSyncQueue,
} from '@modules/github-sync/infrastructure/github-sync.queue'
import type { GitHubSyncRequest } from '@modules/github-sync/infrastructure/github-sync.repository'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryId } from '@repo/domain'
import { Queue, Worker } from 'bullmq'

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const QUEUE_NAME = `${GITHUB_SYNC_QUEUE_NAME}-integration`
const REQUEST: GitHubSyncRequest = {
	repositoryId: '00000000-0000-4000-8000-000000000002' as RepositoryId,
	authorityGeneration: 3,
	requestedSyncVersion: 9,
}
// Derived rather than written out, so a changed fixture cannot leave the
// retention test looking up a job id nothing ever enqueued — which would pass
// against a missing job instead of a recovered one.
const JOB_ID = `${REQUEST.repositoryId}-${REQUEST.authorityGeneration}-${REQUEST.requestedSyncVersion}`

/**
 * The custom job id is what makes duplicate wakeups collapse, and it is also
 * what a retained failed job keeps holding after the run that failed. Only a
 * real queue can show which of those two behaviours wins, so this suite talks
 * to Redis rather than to a mocked `add`.
 */
describe('GitHub sync queue integration', () => {
	let moduleRef: TestingModule
	let queue: Queue
	let service: GitHubSyncQueue

	beforeAll(async () => {
		queue = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } })
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncQueue,
				{ provide: GitHubSyncJobQueue, useValue: queue },
			],
		}).compile()

		service = moduleRef.get(GitHubSyncQueue)
	})

	beforeEach(async () => {
		await queue.obliterate({ force: true })
	})

	afterAll(async () => {
		await queue.obliterate({ force: true })
		await queue.close()
		await moduleRef.close()
	})

	test('collapses a second wakeup for the same version onto one job', async () => {
		await service.enqueue(REQUEST)
		await service.enqueue(REQUEST)

		expect(await queue.getJobCountByTypes('wait')).toBe(1)
	})

	test('gives a later version its own job', async () => {
		await service.enqueue(REQUEST)
		await service.enqueue({ ...REQUEST, requestedSyncVersion: 10 })

		expect(await queue.getJobCountByTypes('wait')).toBe(2)
	})

	test('wakes a version again after its previous job failed and was retained', async () => {
		// Placed with a single attempt so one failure is terminal: the production
		// job allows five, and reaching its failed state through a worker would
		// mean waiting out four exponential backoffs.
		await queue.add(GITHUB_SYNC_REPOSITORY_JOB, REQUEST, {
			jobId: JOB_ID,
			attempts: 1,
			removeOnFail: { count: 200 },
		})
		await failPendingJob()

		const failed = await queue.getJob(JOB_ID)

		// What a rate-limited or attempt-exhausted run leaves behind: a failed job
		// that retention keeps, still holding the id the next wakeup needs.
		expect(await failed?.isFailed()).toBeTruthy()

		await service.enqueue(REQUEST)

		const requeued = await queue.getJob(JOB_ID)

		// Asserted present before its state: `undefined?.isFailed()` is falsy too,
		// so a job that was never re-added would otherwise look like a recovered one.
		expect(requeued).toBeDefined()
		expect(await requeued?.isFailed()).toBeFalsy()
		expect(await queue.getJobCountByTypes('wait')).toBe(1)
	})

	/** Drives one job through active into failed, the way a worker would. */
	async function failPendingJob(): Promise<void> {
		const token = randomUUID()
		const worker = new Worker(QUEUE_NAME, undefined, {
			connection: { url: REDIS_URL },
			autorun: false,
		})

		try {
			const job = await worker.getNextJob(token)
			if (!job) throw new Error('No job available to fail')

			await job.moveToFailed(new Error('rate_limited'), token, false)
		} finally {
			await worker.close()
		}
	}
})

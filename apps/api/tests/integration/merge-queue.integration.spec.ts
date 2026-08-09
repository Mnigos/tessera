import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { status } from '@grpc/grpc-js'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { BranchProtectionModule } from '@modules/branch-protection'
import { PullRequestsModule } from '@modules/pull-requests'
import { MergeQueueProcessor } from '@modules/pull-requests/application/merge-queue.processor'
import { MergeQueueService } from '@modules/pull-requests/application/merge-queue.service'
import {
	MERGE_QUEUE_RECONCILER_JOB,
	MERGE_QUEUE_WAKEUP_JOB,
	MergeQueue,
	type MergeQueueJobData,
} from '@modules/pull-requests/infrastructure/merge-queue.queue'
import { MergeQueueRepository } from '@modules/pull-requests/infrastructure/merge-queue.repository'
import { MergeQueueController } from '@modules/pull-requests/presentation/merge-queue.controller'
import { RepositoriesModule, RepositoryWriteGuard } from '@modules/repositories'
import { type INestApplication, Logger } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { MergeStrategySelection } from '@repo/contracts'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	branchProtectionRules,
	checkObservations,
	checks,
	mergeQueueEntries,
	pullRequestComments,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	repositories,
	repositoryCollaborators,
	repositoryEvents,
	repositoryExternalSources,
	repositoryMergeQueueStates,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type {
	MergeQueueEntryId,
	MergeStrategy,
	PullRequestId,
	RepositoryId,
	UserId,
} from '@repo/domain'
import { mergeStrategies } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import type { Job } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ExternalServiceError } from '~/shared/errors'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
/** One head per source branch, so a merge of one never disturbs the others. */
const HEAD_SHAS = {
	'feature-one': 'b'.repeat(40),
	'feature-two': 'c'.repeat(40),
	'feature-three': 'd'.repeat(40),
}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

interface MergeQueueStatusBody {
	entry?: {
		entryId: MergeQueueEntryId
		state: string
		strategy: MergeStrategy
		position?: number
		blockingReasons?: { code: string }[]
	}
	runnableCount: number
}

interface MergeResultBody {
	status: 'blocked' | 'merged'
	requirements?: { reasons: { code: string }[] }
	pullRequest?: { state: string; mergeCommitSha?: string }
}

describe('Merge queue integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let processor: MergeQueueProcessor
	let enqueueWakeup: ReturnType<typeof vi.fn>
	let mergeRepositoryRefs: ReturnType<typeof vi.fn>
	let findMergeReceipt: ReturnType<typeof vi.fn>
	let checkRepositoryMergeability: ReturnType<typeof vi.fn>
	/** Head refs the mocked storage reports, keyed by source branch. */
	let headShas: Record<string, string>
	/** Source branches Git currently refuses to merge. */
	let conflicting: Set<string>
	let owner: IntegrationUser
	let writer: IntegrationUser
	let reviewer: IntegrationUser
	let repositoryId: RepositoryId

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		enqueueWakeup = vi.fn().mockResolvedValue(undefined)
		mergeRepositoryRefs = vi.fn(({ headRef }: { headRef: string }) =>
			Promise.resolve(toMergeCommitSha(headRef))
		)
		findMergeReceipt = vi.fn(() => Promise.resolve(undefined))
		checkRepositoryMergeability = vi.fn(({ headRef }: { headRef: string }) =>
			Promise.resolve({
				baseSha: BASE_SHA,
				headSha: headShas[headRef] ?? BASE_SHA,
				mergeBaseSha: BASE_SHA,
				mergeable: !conflicting.has(headRef),
				conflictPaths: conflicting.has(headRef) ? ['src/index.ts'] : [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
				strategyAvailability: mergeStrategies.map(strategy => ({
					strategy,
					available: !conflicting.has(headRef),
					reason: conflicting.has(headRef) ? ('conflict' as const) : undefined,
				})),
			})
		)

		// `MergeQueueModule` itself is not imported: registering its Bull queue
		// needs a Redis to register against, and Redis carries no queue state.
		// PostgreSQL is the queue, a wakeup is only a nudge, and this spec
		// delivers those nudges by hand.
		moduleRef = await Test.createTestingModule({
			imports: [
				EnvModule,
				DatabaseModule,
				GitStorageModule,
				RPCModule,
				AuthModule,
				RepositoriesModule,
				BranchProtectionModule,
				PullRequestsModule,
			],
			controllers: [MergeQueueController],
			providers: [
				MergeQueueService,
				MergeQueueProcessor,
				RepositoryWriteGuard,
				{ provide: MergeQueue, useValue: { enqueueWakeup } },
				{ provide: APP_FILTER, useClass: GlobalExceptionFilter },
			],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				listRepositoryRefs: vi.fn(() =>
					Promise.resolve({
						branches: [
							{
								type: 'branch',
								name: 'main',
								qualifiedName: 'refs/heads/main',
								target: BASE_SHA,
							},
							...Object.entries(headShas).map(([name, target]) => ({
								type: 'branch',
								name,
								qualifiedName: `refs/heads/${name}`,
								target,
							})),
						],
						tags: [],
					})
				),
				compareRepositoryRefs: vi.fn(({ headRef }: { headRef: string }) =>
					Promise.resolve({
						baseSha: BASE_SHA,
						headSha: headShas[headRef] ?? BASE_SHA,
						mergeBaseSha: BASE_SHA,
						commits: [],
						files: [],
						isTruncated: false,
						commitsTruncated: false,
						commitLimit: 500,
						fileLimit: 300,
					})
				),
				mergeRepositoryRefs,
				findMergeReceipt,
				checkRepositoryMergeability,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
		processor = moduleRef.get(MergeQueueProcessor)
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		enqueueWakeup.mockClear()
		mergeRepositoryRefs.mockClear()
		findMergeReceipt.mockClear()
		findMergeReceipt.mockResolvedValue(undefined)
		mergeRepositoryRefs.mockImplementation(({ headRef }: { headRef: string }) =>
			Promise.resolve(toMergeCommitSha(headRef))
		)
		headShas = { ...HEAD_SHAS }
		conflicting = new Set()

		owner = await createIntegrationUser('owner')
		writer = await createIntegrationUser('writer')
		reviewer = await createIntegrationUser('reviewer')
		repositoryId = await createRepository()
		await db.insert(repositoryCollaborators).values([
			{ repositoryId, userId: writer.id, role: 'write' },
			{ repositoryId, userId: reviewer.id, role: 'write' },
		])
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('joins the queue over HTTP, records the entry, and counts positions from the front', async () => {
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')

		const first = await joinQueue(1, writer.headers)
		expect(first).toMatchObject({
			entry: { state: 'queued', position: 1 },
			runnableCount: 1,
		})
		expect(await findPullRequestEvent(1, 'queue_entered')).toMatchObject({
			actorUserId: writer.id,
			payload: {
				queueEntryId: first.entry?.entryId,
				position: 1,
				enqueuedHeadSha: HEAD_SHAS['feature-one'],
			},
		})

		expect(await joinQueue(2, writer.headers)).toMatchObject({
			entry: { state: 'queued', position: 2 },
			runnableCount: 2,
		})
		expect(await readQueueStatus(1, writer.headers)).toMatchObject({
			entry: { position: 1 },
			runnableCount: 2,
		})
		expect(enqueueWakeup).toHaveBeenCalledWith(
			expect.objectContaining({ repositoryId })
		)
	})

	test('allocates unique positions to concurrent joins', async () => {
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await createPullRequest(3, 'feature-three')

		const responses = await Promise.all([
			joinMergeQueue(1, writer.headers),
			joinMergeQueue(2, writer.headers),
			joinMergeQueue(3, reviewer.headers),
		])

		for (const response of responses) expect(response.status).toBe(200)
		expect(
			(
				await db
					.select({ position: mergeQueueEntries.position })
					.from(mergeQueueEntries)
					.orderBy(mergeQueueEntries.position)
			).map(entry => entry.position)
		).toEqual([1, 2, 3])
	})

	test('keeps one active entry per pull request', async () => {
		await createPullRequest(1, 'feature-one')
		await joinQueue(1, writer.headers)

		const response = await joinMergeQueue(1, writer.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.code).toBe('CONFLICT')
		expect(await countEntries()).toBe(1)
	})

	test('lets an administrator remove somebody else’s entry but not another writer', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)

		const forbidden = await leaveMergeQueue(1, reviewer.headers)
		expect(forbidden.status).toBe(403)
		expect((await forbidden.json()) as ErrorResponseBody).toMatchObject({
			code: 'FORBIDDEN',
		})

		const response = await leaveMergeQueue(1, owner.headers)
		expect(response.status).toBe(200)
		expect((await response.json()) as MergeQueueStatusBody).toEqual({
			runnableCount: 0,
		})
		expect(await findPullRequestEvent(1, 'queue_removed')).toMatchObject({
			actorUserId: owner.id,
			payload: {
				queueEntryId: queued.entry?.entryId,
				position: 1,
				reason: 'admin',
			},
		})
	})

	test('sends a retried entry back to the tail of the queue', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 1 })
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await joinQueue(1, writer.headers)
		await runWorker()

		// A paused entry holds no place at all: nothing is waiting behind it.
		const paused = await readQueueStatus(1, writer.headers)
		expect(paused).toMatchObject({
			entry: { state: 'paused' },
			runnableCount: 0,
		})
		expect(paused.entry?.position).toBeUndefined()

		await joinQueue(2, writer.headers)
		const retried = await retryMergeQueueEntry(1, writer.headers)
		expect(retried.status).toBe(200)
		expect((await retried.json()) as MergeQueueStatusBody).toMatchObject({
			entry: { state: 'queued', position: 2 },
		})
		expect(await findPullRequestEvent(1, 'queue_resumed')).toMatchObject({
			actorUserId: writer.id,
			payload: { position: 3 },
		})
	})

	test('merges the entry at the front and completes it with the merge', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)

		await runWorker()

		expect(await findPullRequest(1)).toMatchObject({
			state: 'merged',
			mergeCommitSha: toMergeCommitSha('feature-one'),
			mergeActorUserId: writer.id,
		})
		expect(await findEntry(queued.entry?.entryId)).toMatchObject({
			state: 'completed',
		})
		expect(mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBaseSha: BASE_SHA,
				expectedHeadSha: HEAD_SHAS['feature-one'],
			})
		)
		expect(await listEventTypes(1)).toEqual([
			'opened',
			'queue_entered',
			'merged',
		])
	})

	// The queue decides when a pull request merges, not how. Whatever was chosen
	// at the door is what the run that reaches the entry asks Git for.
	test('merges a queued entry by the method it was queued with', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers, {
			strategy: 'squash',
			squashTitle: 'Queued squash (#1)',
			squashBody: 'Queued body',
		})

		expect(queued.entry).toMatchObject({ strategy: 'squash' })

		await runWorker()

		expect(mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({
				strategy: 'squash',
				squashTitle: 'Queued squash (#1)',
				squashBody: 'Queued body',
			})
		)
		expect(await findPullRequest(1)).toMatchObject({
			state: 'merged',
			mergeStrategy: 'squash',
		})
	})

	// Pausing and retrying an entry is asking the queue to look again, not to
	// choose again: the method it was queued with survives the round trip.
	test('keeps the queued method across a pause and a retry', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 1 })
		await createPullRequest(1, 'feature-one')
		await joinQueue(1, writer.headers, { strategy: 'rebase' })
		await runWorker()

		expect(await readQueueStatus(1, writer.headers)).toMatchObject({
			entry: { state: 'paused', strategy: 'rebase' },
		})

		await submitReview(1, reviewer.headers, HEAD_SHAS['feature-one'])
		await retryMergeQueueEntry(1, writer.headers)
		await runWorker()

		expect(mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'rebase' })
		)
		expect(await findPullRequest(1)).toMatchObject({
			state: 'merged',
			mergeStrategy: 'rebase',
		})
	})

	// A run that reached Git and died before recording it left the target where
	// its own merge put it, which a fresh evaluation would read as staleness. The
	// receipt is what says whether that merge actually happened.
	test('records an abandoned merge git storage had already made', async () => {
		await createPullRequest(1, 'feature-one')
		await joinQueue(1, writer.headers)
		await insertAbandonedMergeIntent(1, 'squash')
		findMergeReceipt.mockResolvedValue(toMergeCommitSha('feature-one'))

		await runWorker()

		expect(await findPullRequest(1)).toMatchObject({
			state: 'merged',
			mergeStrategy: 'squash',
			mergeCommitSha: toMergeCommitSha('feature-one'),
		})
		// Nothing was merged: the merge already existed.
		expect(mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	// Running it would merge unattended on the strength of an evaluation nobody
	// repeated, under an actor and a waiver it inherited.
	test('never merges an abandoned intent git storage has no receipt for', async () => {
		await createPullRequest(1, 'feature-one')
		await joinQueue(1, writer.headers, { strategy: 'rebase' })
		await insertAbandonedMergeIntent(1, 'squash')
		findMergeReceipt.mockResolvedValue(undefined)

		await runWorker()

		// The entry was judged on its own merits and merged by the method it was
		// queued with, not by the abandoned attempt's.
		expect(mergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({ strategy: 'rebase' })
		)
		expect(await findPullRequest(1)).toMatchObject({
			state: 'merged',
			mergeStrategy: 'rebase',
		})
	})

	test('pauses an ineligible entry with its reasons and runs the next one anyway', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 1 })
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await submitReview(2, reviewer.headers, HEAD_SHAS['feature-two'])
		const blocked = await joinQueue(1, writer.headers)
		await joinQueue(2, writer.headers)

		await runWorker()

		expect(await findEntry(blocked.entry?.entryId)).toMatchObject({
			state: 'paused',
			blockingReasons: [
				expect.objectContaining({ code: 'approvals_required' }),
			],
		})
		expect(await findPullRequest(1)).toMatchObject({ state: 'open' })
		expect(await findPullRequestEvent(1, 'queue_paused')).toMatchObject({
			payload: {
				reasonCodes: ['approvals_required'],
				evaluatedBaseSha: BASE_SHA,
				evaluatedHeadSha: HEAD_SHAS['feature-one'],
			},
		})
		expect(await findPullRequest(2)).toMatchObject({ state: 'merged' })
	})

	test('re-evaluates the entry behind a merge against the target the merge moved', async () => {
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await joinQueue(1, writer.headers)
		const second = await joinQueue(2, writer.headers)
		// The first merge is what makes the second one conflict: nothing about the
		// second pull request changed, only the branch it is being merged into.
		mergeRepositoryRefs.mockImplementationOnce(
			({ headRef }: { headRef: string }) => {
				conflicting.add('feature-two')

				return Promise.resolve(toMergeCommitSha(headRef))
			}
		)

		await runWorker()

		expect(await findPullRequest(1)).toMatchObject({ state: 'merged' })
		expect(await findPullRequest(2)).toMatchObject({ state: 'open' })
		expect(await findEntry(second.entry?.entryId)).toMatchObject({
			state: 'paused',
			blockingReasons: [expect.objectContaining({ code: 'merge_conflict' })],
		})
		expect(mergeRepositoryRefs).toHaveBeenCalledTimes(1)
	})

	test('never merges two entries of one repository at the same time', async () => {
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await joinQueue(1, writer.headers)
		await joinQueue(2, writer.headers)
		let inFlight = 0
		let overlapped = false
		mergeRepositoryRefs.mockImplementation(
			async ({ headRef }: { headRef: string }) => {
				inFlight += 1
				overlapped ||= inFlight > 1
				await new Promise(resolve => setTimeout(resolve, 25))
				inFlight -= 1

				return toMergeCommitSha(headRef)
			}
		)

		await Promise.all([runWorker(), runWorker(2)])

		expect(overlapped).toBeFalsy()
		expect(await findPullRequest(1)).toMatchObject({ state: 'merged' })
		expect(await findPullRequest(2)).toMatchObject({ state: 'merged' })
		expect(mergeRepositoryRefs).toHaveBeenCalledTimes(2)
	})

	test('gives one pull request to either the direct merge or the worker, never both', async () => {
		await createPullRequest(1, 'feature-one')
		await joinQueue(1, writer.headers)
		mergeRepositoryRefs.mockImplementation(
			async ({ headRef }: { headRef: string }) => {
				await new Promise(resolve => setTimeout(resolve, 25))

				return toMergeCommitSha(headRef)
			}
		)

		const [, directResponse] = await Promise.all([
			runWorker(),
			mergePullRequest(1, writer.headers, {
				expectedBaseSha: BASE_SHA,
				expectedHeadSha: HEAD_SHAS['feature-one'],
			}),
		])

		expect(await findPullRequest(1)).toMatchObject({ state: 'merged' })
		expect(mergeRepositoryRefs).toHaveBeenCalledTimes(1)
		expect(
			(await listEventTypes(1)).filter(type => type === 'merged')
		).toHaveLength(1)

		const direct = (await directResponse.json()) as MergeResultBody
		if (direct.status === 'blocked')
			expect(direct.requirements?.reasons.map(reason => reason.code)).toContain(
				'repository_merge_in_progress'
			)
		else expect(direct.pullRequest).toMatchObject({ state: 'merged' })
	})

	test('refuses a direct merge while other entries are still waiting to run', async () => {
		await createPullRequest(1, 'feature-one')
		await createPullRequest(2, 'feature-two')
		await joinQueue(2, writer.headers)

		const response = await mergePullRequest(1, writer.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHAS['feature-one'],
		})

		expect(response.status).toBe(200)
		expect((await response.json()) as MergeResultBody).toMatchObject({
			status: 'blocked',
			requirements: { reasons: [{ code: 'merge_queue_required' }] },
		})
		expect(await findPullRequest(1)).toMatchObject({ state: 'open' })
		expect(mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	test('pauses the entry without moving the target when Git rejects the swap', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)
		// What the storage client raises when Git refuses the compare-and-swap
		// because the refs it was given no longer describe the branches.
		mergeRepositoryRefs.mockRejectedValue(
			new ExternalServiceError('git storage', { grpcCode: status.ABORTED })
		)
		headShas['feature-one'] = 'e'.repeat(40)

		await runWorker()

		expect(await findPullRequest(1)).toMatchObject({
			state: 'open',
			mergeCommitSha: null,
		})
		expect(await findEntry(queued.entry?.entryId)).toMatchObject({
			state: 'paused',
			blockingReasons: [expect.objectContaining({ code: 'stale_refs' })],
		})
		// A rejected attempt hands its merge intent back rather than locking the
		// pull request out of the next one.
		expect(await db.query.pullRequestMergeIntents.findFirst()).toBeUndefined()
	})

	test('removes the active entry when its pull request closes', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)

		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1/close',
			{ method: 'POST', headers: writer.headers }
		)
		expect(response.status).toBe(200)

		expect(await findEntry(queued.entry?.entryId)).toMatchObject({
			state: 'removed',
		})
		expect(await findPullRequestEvent(1, 'queue_removed')).toMatchObject({
			payload: { queueEntryId: queued.entry?.entryId, reason: 'closed' },
		})
	})

	test('reconciles an entry whose pull request stopped being open behind its back', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)
		// A mirror synchronization closes a pull request without going through the
		// path that would have taken its entry with it.
		await db
			.update(pullRequests)
			.set({ state: 'closed', closedAt: new Date() })
			.where(eq(pullRequests.id, await findPullRequestId(1)))

		await runReconciler()

		expect(await findEntry(queued.entry?.entryId)).toMatchObject({
			state: 'removed',
		})
		expect(await findPullRequestEvent(1, 'queue_removed')).toMatchObject({
			payload: { reason: 'closed' },
		})
	})

	test('recovers entries and a lease a dead run left behind', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)
		const entryId = queued.entry?.entryId

		if (!entryId) throw new Error('Failed to queue the pull request')

		await db
			.update(mergeQueueEntries)
			.set({ state: 'validating', validatingAt: new Date() })
			.where(eq(mergeQueueEntries.id, entryId))
		await db
			.update(repositoryMergeQueueStates)
			.set({
				leaseOwner: 'dead-run',
				leaseAcquiredAt: new Date(Date.now() - 600_000),
				leaseExpiresAt: new Date(Date.now() - 300_000),
			})
			.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))

		await runWorker()

		expect(await findPullRequest(1)).toMatchObject({ state: 'merged' })
		expect(await findEntry(entryId)).toMatchObject({ state: 'completed' })
		expect(
			await db.query.repositoryMergeQueueStates.findFirst({
				columns: { leaseOwner: true },
			})
		).toEqual({ leaseOwner: null })
	})

	// The join resolves the refs from Git between checking that the pull request
	// is open and writing the entry, and a close committing in that window used to
	// leave an active entry — and a `queue_entered` event — on a closed pull
	// request. The enqueue takes the pull request's own row, so one of the two
	// waits for the other and the join loses outright.
	test('writes no entry when the pull request closes while the join resolves refs', async () => {
		await createPullRequest(1, 'feature-one')
		checkRepositoryMergeability.mockImplementationOnce(async () => {
			await db
				.update(pullRequests)
				.set({ state: 'closed', closedAt: new Date() })
				.where(eq(pullRequests.id, await findPullRequestId(1)))

			return {
				baseSha: BASE_SHA,
				headSha: HEAD_SHAS['feature-one'],
				mergeBaseSha: BASE_SHA,
				mergeable: true,
				conflictPaths: [],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
			}
		})

		const response = await joinMergeQueue(1, writer.headers)

		expect(response.status).toBe(409)
		expect((await response.json()) as ErrorResponseBody).toMatchObject({
			code: 'CONFLICT',
		})
		expect(await countEntries()).toBe(0)
		expect(await listEventTypes(1)).not.toContain('queue_entered')
	})

	// Every entry transition the worker makes is conditional on the lease it
	// believes it holds. A run whose hold aged out may be looking at an entry the
	// next holder has already reclaimed, and writing to it would park somebody
	// else's work with a verdict about a repository it no longer serves.
	test('refuses a pause from a run whose lease was taken over', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)
		const entryId = queued.entry?.entryId

		if (!entryId) throw new Error('Failed to queue the pull request')

		const mergeQueueRepository = moduleRef.get(MergeQueueRepository)

		await db
			.update(mergeQueueEntries)
			.set({ state: 'validating', validatingAt: new Date() })
			.where(eq(mergeQueueEntries.id, entryId))
		// The expired run's entry, reclaimed by a live one.
		await db
			.update(repositoryMergeQueueStates)
			.set({
				leaseOwner: 'live-run',
				leaseAcquiredAt: new Date(),
				leaseExpiresAt: new Date(Date.now() + 120_000),
			})
			.where(eq(repositoryMergeQueueStates.repositoryId, repositoryId))

		expect(
			await mergeQueueRepository.pauseEntry({
				entryId,
				leaseOwner: 'expired-run',
				pullRequestId: await findPullRequestId(1),
				blockingReasons: [{ code: 'repository_merge_in_progress' }],
			})
		).toBeFalsy()
		expect(await findEntry(entryId)).toMatchObject({ state: 'validating' })
		expect(await listEventTypes(1)).not.toContain('queue_paused')

		// The holder of the lease writes the same pause without objection.
		expect(
			await mergeQueueRepository.pauseEntry({
				entryId,
				leaseOwner: 'live-run',
				pullRequestId: await findPullRequestId(1),
				blockingReasons: [{ code: 'repository_merge_in_progress' }],
			})
		).toBeTruthy()
		expect(await findEntry(entryId)).toMatchObject({ state: 'paused' })
	})

	// Git has been handed the branch by the time an entry is merging. Withdrawing
	// it from under that would leave a pull request that merged beside a queue
	// entry that says it was removed.
	test('refuses to leave the queue while the entry is being merged', async () => {
		await createPullRequest(1, 'feature-one')
		const queued = await joinQueue(1, writer.headers)
		const entryId = queued.entry?.entryId

		if (!entryId) throw new Error('Failed to queue the pull request')

		await db
			.update(mergeQueueEntries)
			.set({ state: 'merging', mergingAt: new Date() })
			.where(eq(mergeQueueEntries.id, entryId))

		const response = await leaveMergeQueue(1, writer.headers)

		expect(response.status).toBe(409)
		expect((await response.json()) as ErrorResponseBody).toMatchObject({
			code: 'CONFLICT',
		})
		expect(await findEntry(entryId)).toMatchObject({ state: 'merging' })
		expect(await listEventTypes(1)).not.toContain('queue_removed')
	})

	test('refuses to queue a pull request on a repository GitHub is authoritative for', async () => {
		await createPullRequest(1, 'feature-one')
		await db.insert(repositoryExternalSources).values({
			repositoryId,
			provider: 'github',
			externalRepositoryId: 4242n,
			ownerLogin: 'tessera-org',
			name: 'notes',
			fullName: 'tessera-org/notes',
			sourceUrl: 'https://github.com/tessera-org/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
		})

		const response = await joinMergeQueue(1, writer.headers)

		expect(response.status).toBe(403)
		expect((await response.json()) as ErrorResponseBody).toMatchObject({
			code: 'FORBIDDEN',
		})
		expect(await countEntries()).toBe(0)
	})

	function runWorker(requestedVersion = 1) {
		return processor.process(
			createJob(MERGE_QUEUE_WAKEUP_JOB, { repositoryId, requestedVersion })
		)
	}

	function runReconciler() {
		return processor.process(
			createJob(MERGE_QUEUE_RECONCILER_JOB, { type: 'reconciler' })
		)
	}

	function createJob(name: string, data: MergeQueueJobData) {
		return { name, data } as Job<MergeQueueJobData>
	}

	function toMergeCommitSha(sourceBranch: string) {
		return `${sourceBranch.replace(/[^0-9a-f]/g, '0')}`
			.padEnd(40, 'f')
			.slice(0, 40)
	}

	/** An attempt that wrote its intent and then stopped existing. */
	async function insertAbandonedMergeIntent(
		number: number,
		strategy: MergeStrategy
	): Promise<void> {
		await db.insert(pullRequestMergeIntents).values({
			pullRequestId: await findPullRequestId(number),
			attemptId: '00000000-0000-4000-8000-000000000099',
			actorUserId: writer.id,
			strategy,
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHAS['feature-one'],
			squashTitle: strategy === 'squash' ? 'The abandoned title' : null,
			squashBody: strategy === 'squash' ? '' : null,
			startedAt: new Date(Date.now() - 10 * 60 * 1000),
		})
	}

	async function joinQueue(
		number: number,
		headers: Headers,
		selection: MergeStrategySelection = { strategy: 'merge_commit' }
	): Promise<MergeQueueStatusBody> {
		const response = await joinMergeQueue(number, headers, selection)

		if (response.status !== 200)
			throw new Error(
				`Failed to join the merge queue of pull request ${number}: ${response.status}`
			)

		return (await response.json()) as MergeQueueStatusBody
	}

	async function readQueueStatus(
		number: number,
		headers: Headers
	): Promise<MergeQueueStatusBody> {
		const response = await adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/${number}`,
			{ headers }
		)
		const body = (await response.json()) as { mergeQueue: MergeQueueStatusBody }

		return body.mergeQueue
	}

	function joinMergeQueue(
		number: number,
		headers: Headers,
		selection: MergeStrategySelection = { strategy: 'merge_commit' }
	) {
		return request(
			`http://localhost/repositories/owner/notes/pulls/${number}/merge-queue`,
			'POST',
			headers,
			selection
		)
	}

	function leaveMergeQueue(number: number, headers: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/${number}/merge-queue`,
			{ method: 'DELETE', headers }
		)
	}

	function retryMergeQueueEntry(number: number, headers: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/${number}/merge-queue/retry`,
			{ method: 'POST', headers }
		)
	}

	function mergePullRequest(number: number, headers: Headers, input: object) {
		// The merge method is an explicit choice the contract requires, exactly as
		// the web client always sends one. A body that names none merges the way
		// every merge did before strategies existed.
		return request(
			`http://localhost/repositories/owner/notes/pulls/${number}/merge`,
			'POST',
			headers,
			{ strategy: 'merge_commit', ...input }
		)
	}

	async function createIntegrationUser(
		username: string
	): Promise<IntegrationUser> {
		const token = crypto.randomUUID()
		const [createdUser] = await db
			.insert(user)
			.values({
				name: username,
				email: `${username}@example.com`,
				emailVerified: true,
				username,
			})
			.returning({ id: user.id })

		if (!createdUser) throw new Error('Failed to create integration user')

		await db.insert(session).values({
			token,
			userId: createdUser.id,
			expiresAt: new Date(Date.now() + 86_400_000),
		})

		const headers = new Headers()
		headers.set(
			'cookie',
			`better-auth.session_token=${token}.${await makeSignature(
				token,
				'test-auth-secret'
			)}`
		)

		return { id: createdUser.id, headers, username }
	}

	async function createRepository(): Promise<RepositoryId> {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			owner.headers,
			{ name: 'Notes', slug: 'notes', visibility: 'private' }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		const repository = await db.query.repositories.findFirst({
			columns: { id: true },
		})

		if (!repository) throw new Error('Failed to find the created repository')

		return repository.id
	}

	async function createPullRequest(number: number, sourceBranch: string) {
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls',
			'POST',
			owner.headers,
			{ sourceBranch, targetBranch: 'main', title: `Change ${number}` }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create pull request: ${response.status}`)
	}

	async function createRule(input: object) {
		const response = await request(
			'http://localhost/repositories/owner/notes/branch-protection',
			'PUT',
			owner.headers,
			input
		)

		if (response.status !== 200)
			throw new Error(`Failed to save protection rule: ${response.status}`)
	}

	async function submitReview(
		number: number,
		headers: Headers,
		expectedHeadSha: string
	) {
		const response = await request(
			`http://localhost/repositories/owner/notes/pulls/${number}/reviews`,
			'POST',
			headers,
			{ outcome: 'approve', expectedHeadSha }
		)

		if (response.status !== 200)
			throw new Error(`Failed to submit review: ${response.status}`)
	}

	async function findPullRequestId(number: number): Promise<PullRequestId> {
		const pullRequest = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.number, number),
			columns: { id: true },
		})

		if (!pullRequest) throw new Error(`Pull request ${number} is missing`)

		return pullRequest.id
	}

	async function findPullRequest(number: number) {
		return await db.query.pullRequests.findFirst({
			where: eq(pullRequests.number, number),
			columns: {
				state: true,
				mergeCommitSha: true,
				mergeStrategy: true,
				mergeActorUserId: true,
			},
		})
	}

	async function findEntry(entryId: MergeQueueEntryId | undefined) {
		if (!entryId) throw new Error('Missing merge queue entry id')

		return await db.query.mergeQueueEntries.findFirst({
			where: eq(mergeQueueEntries.id, entryId),
			columns: { state: true, blockingReasons: true, position: true },
		})
	}

	async function countEntries(): Promise<number> {
		return (
			await db.select({ id: mergeQueueEntries.id }).from(mergeQueueEntries)
		).length
	}

	async function findPullRequestEvent(number: number, type: string) {
		const events = await listEvents(number)

		return events.find(event => event.type === type)
	}

	async function listEventTypes(number: number): Promise<string[]> {
		return (await listEvents(number)).map(event => event.type)
	}

	async function listEvents(number: number) {
		return await db.query.pullRequestEvents.findMany({
			where: eq(
				pullRequestEvents.pullRequestId,
				await findPullRequestId(number)
			),
			orderBy: (events, { asc }) => [asc(events.createdAt), asc(events.id)],
		})
	}

	function request(
		url: string,
		method: 'POST' | 'PUT',
		headers: Headers,
		body: object
	) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(url, {
			method,
			headers: requestHeaders,
			body: JSON.stringify(body),
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(pullRequestEvents)
		await db.delete(mergeQueueEntries)
		await db.delete(repositoryMergeQueueStates)
		await db.delete(pullRequestMergeIntents)
		await db.delete(pullRequestComments)
		await db.delete(pullRequestThreads)
		await db.delete(pullRequestReviewerRequests)
		await db.delete(pullRequestReviews)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(checkObservations)
		await db.delete(checks)
		await db.delete(branchProtectionRules)
		await db.delete(repositoryEvents)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})

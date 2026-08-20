import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { RPCModule } from '@config/rpc'
import { AuthModule } from '@modules/auth'
import { ChecksModule } from '@modules/checks'
import { GitHubSyncProcessor } from '@modules/github-sync/application/github-sync.processor'
import { GitHubSyncReplayService } from '@modules/github-sync/application/github-sync-replay.service'
import { GitHubSyncExternalServiceError } from '@modules/github-sync/domain/github-sync.errors'
import { GitHubAppAuthService } from '@modules/github-sync/infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '@modules/github-sync/infrastructure/github-sync.client'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_REPOSITORY_JOB,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '@modules/github-sync/infrastructure/github-sync.queue'
import {
	GitHubSyncRepository,
	type GitHubSyncRequest,
} from '@modules/github-sync/infrastructure/github-sync.repository'
import { GitHubSyncChecksRepository } from '@modules/github-sync/infrastructure/github-sync-checks.repository'
import { GitHubSyncConversationsRepository } from '@modules/github-sync/infrastructure/github-sync-conversations.repository'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import {
	type RepositorySyncHealthFacts,
	toRepositorySyncHealth,
} from '@modules/repositories/domain/repository-sync-health'
import { RepositorySyncHealthRepository } from '@modules/repositories/infrastructure/repository-sync-health.repository'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubInstallationId, GitHubWebhookDeliveryId } from '@repo/db'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	gitHubActors,
	gitHubInstallations,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	gitHubSyncAttempts,
	gitHubWebhookDeliveries,
	pullRequestEvents,
	pullRequests,
	repositories,
	repositoryCollaborators,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import type { Job } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const HEAD_SHA = 'b'.repeat(40)
const BASE_SHA = 'a'.repeat(40)
const PRIMARY_EXTERNAL_REPOSITORY_ID = 4242
const SECONDARY_EXTERNAL_REPOSITORY_ID = 4343
const PRIMARY_INSTALLATION_ID = 8888
const SECONDARY_INSTALLATION_ID = 9999
const SYNC_INTERVAL_MINUTES = 60
const MISSING_FACTS: RepositorySyncHealthFacts = {
	syncStatus: 'pending',
	pendingDeliveryCount: 0,
	retryCount24h: 0,
	terminalCount24h: 0,
	completedCount24h: 0,
}

interface MirrorFixture {
	repositoryId: RepositoryId
	installationId: GitHubInstallationId
}

describe('GitHub sync operations integration', () => {
	let moduleRef: TestingModule
	let processor: GitHubSyncProcessor
	let syncRepository: GitHubSyncRepository
	let healthRepository: RepositorySyncHealthRepository
	let replayService: GitHubSyncReplayService
	let enqueue: ReturnType<typeof vi.fn>
	let getRepositoryReconciliation: ReturnType<typeof vi.fn>
	let ownerUserId: UserId
	let primary: MirrorFixture

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		enqueue = vi.fn().mockResolvedValue(undefined)
		getRepositoryReconciliation = vi.fn(() =>
			Promise.resolve(reconciliation(PRIMARY_EXTERNAL_REPOSITORY_ID))
		)
		moduleRef = await Test.createTestingModule({
			imports: [
				EnvModule,
				DatabaseModule,
				GitStorageModule,
				RPCModule,
				AuthModule,
				RepositoriesModule,
				PullRequestsModule,
				ChecksModule,
			],
			providers: [
				GitHubSyncProcessor,
				GitHubSyncReplayService,
				GitHubSyncRepository,
				GitHubSyncChecksRepository,
				GitHubSyncConversationsRepository,
				{ provide: GitHubSyncQueue, useValue: { enqueue } },
				{
					provide: GitHubAppAuthService,
					useValue: {
						getInstallationToken: vi.fn().mockResolvedValue({
							token: 'installation-token',
							expiresAt: new Date('2026-08-11T12:00:00Z'),
						}),
						evictInstallationToken: vi.fn(),
					},
				},
				{
					provide: GitHubSyncClient,
					useValue: {
						getRepositoryReconciliation,
						getChecksForRef: vi.fn(({ ref }: { ref: string }) =>
							Promise.resolve({ sha: ref, suites: [], runs: [], statuses: [] })
						),
						getPullRequestConversation: vi.fn(() =>
							Promise.resolve({
								issueComments: [],
								reviewComments: [],
								reviews: [],
								requestedReviewers: [],
								reviewThreads: [],
							})
						),
					},
				},
			],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				importRepository: vi.fn(({ storagePath }) =>
					Promise.resolve({ storagePath, defaultBranch: 'main' })
				),
				compareRepositoryRefs: vi.fn().mockResolvedValue({
					baseSha: BASE_SHA,
					headSha: HEAD_SHA,
					mergeBaseSha: BASE_SHA,
					commits: [],
					files: [],
					isTruncated: false,
					commitsTruncated: false,
					commitLimit: 500,
					fileLimit: 300,
				}),
			})
			.compile()

		await moduleRef.init()
		processor = moduleRef.get(GitHubSyncProcessor)
		syncRepository = moduleRef.get(GitHubSyncRepository)
		healthRepository = moduleRef.get(RepositorySyncHealthRepository)
		replayService = moduleRef.get(GitHubSyncReplayService)
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		enqueue.mockClear()
		getRepositoryReconciliation
			.mockReset()
			.mockImplementation(() =>
				Promise.resolve(reconciliation(PRIMARY_EXTERNAL_REPOSITORY_ID))
			)
		ownerUserId = await createOwner('maya')
		primary = await createMirror({
			slug: 'notes',
			externalRepositoryId: PRIMARY_EXTERNAL_REPOSITORY_ID,
			externalInstallationId: PRIMARY_INSTALLATION_ID,
		})
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('records one attempt per run and derives healthy sync health from it', async () => {
		await runDueReconciliations()

		expect(await listAttempts(primary.repositoryId)).toEqual([
			expect.objectContaining({
				trigger: 'scheduled',
				status: 'succeeded',
				attemptNumber: 1,
				failureClass: null,
			}),
		])
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'healthy',
			pendingDeliveryCount: 0,
			retryCount24h: 0,
			failureRate24h: 0,
		})
	})

	test('counts retries of one version separately from the operations that ended', async () => {
		getRepositoryReconciliation.mockRejectedValue(
			new GitHubSyncExternalServiceError({
				failureClass: 'transport',
				failureCode: 'upstream_unavailable',
				scope: 'repository',
				statusCode: 503,
			})
		)

		await expect(runDueReconciliations()).rejects.toThrow(
			'GitHub synchronization failed'
		)
		// The queue retries the same job, and the source's own failure counter
		// cannot tell that from a second operation. The attempt rows can.
		await expect(
			runRequest(await requestFor(primary.repositoryId))
		).rejects.toThrow('GitHub synchronization failed')

		expect(
			(await listAttempts(primary.repositoryId)).map(attempt => [
				attempt.attemptNumber,
				attempt.status,
			])
		).toEqual([
			[1, 'retry_scheduled'],
			[2, 'retry_scheduled'],
		])
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'failed',
			retryCount24h: 2,
			code: 'upstream_unavailable',
		})
	})

	test('holds back a rate-limited installation while another keeps reconciling', async () => {
		const secondary = await createMirror({
			slug: 'docs',
			externalRepositoryId: SECONDARY_EXTERNAL_REPOSITORY_ID,
			externalInstallationId: SECONDARY_INSTALLATION_ID,
		})
		await syncRepository.recordInstallationRateLimit({
			installationId: primary.installationId,
			observedAt: new Date(),
			remaining: 0,
			rateLimitedUntil: new Date(Date.now() + 30 * 60_000),
		})

		expect(
			(
				await syncRepository.requestDueReconciliations({
					limit: 25,
					now: new Date(),
				})
			).map(request => request.repositoryId)
		).toEqual([secondary.repositoryId])
		// A job already queued for the limited installation cannot claim either, so
		// the request is not spent against a GitHub that is still refusing.
		expect(
			await syncRepository.claimSync({
				...(await requestFor(primary.repositoryId)),
				leaseOwner: 'lease-owner',
				leaseAcquiredAt: new Date(),
				leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
			})
		).toBeFalsy()
	})

	test('reconciles a deferred installation again once its limit has passed', async () => {
		await syncRepository.recordInstallationRateLimit({
			installationId: primary.installationId,
			observedAt: new Date(),
			remaining: 0,
			rateLimitedUntil: new Date(Date.now() - 60_000),
		})

		expect(
			(
				await syncRepository.requestDueReconciliations({
					limit: 25,
					now: new Date(),
				})
			).map(request => request.repositoryId)
		).toEqual([primary.repositoryId])
	})

	test('never shortens a deferral another repository already recorded', async () => {
		const longDefer = new Date(Date.now() + 60 * 60_000)
		await syncRepository.recordInstallationRateLimit({
			installationId: primary.installationId,
			observedAt: new Date(),
			rateLimitedUntil: longDefer,
		})
		await syncRepository.recordInstallationRateLimit({
			installationId: primary.installationId,
			observedAt: new Date(),
			rateLimitedUntil: new Date(Date.now() + 60_000),
		})

		expect(
			(
				await db.query.gitHubInstallations.findFirst({
					where: eq(gitHubInstallations.id, primary.installationId),
				})
			)?.rateLimitedUntil
		).toEqual(longDefer)
	})

	test('blocks the repository and stops the schedule when GitHub rejects access', async () => {
		getRepositoryReconciliation.mockRejectedValue(
			new GitHubSyncExternalServiceError({
				failureClass: 'authentication',
				failureCode: 'repository_unavailable',
				scope: 'repository',
				statusCode: 404,
			})
		)

		await expect(runDueReconciliations()).rejects.toThrow(
			'repository_unavailable'
		)

		const source = await findSource(primary.repositoryId)

		expect(source).toMatchObject({
			syncStatus: 'blocked',
			syncFailureCode: 'repository_unavailable',
			nextSyncAt: null,
			syncLeaseOwner: null,
			// The generation moves so anything still in flight under the old one is
			// fenced out of writing.
			authorityGeneration: 2,
		})
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'blocked',
			reauthorizationRequired: true,
		})
		// A blocked repository is not due for anything.
		expect(
			await syncRepository.requestDueReconciliations({
				limit: 25,
				now: new Date(),
			})
		).toEqual([])
	})

	test('resumes a blocked mirror when GitHub says the installation is back', async () => {
		getRepositoryReconciliation.mockRejectedValueOnce(
			new GitHubSyncExternalServiceError({
				failureClass: 'authentication',
				failureCode: 'repository_unavailable',
				scope: 'repository',
				statusCode: 404,
			})
		)
		await expect(runDueReconciliations()).rejects.toThrow(
			'repository_unavailable'
		)

		const { syncRequests } = await syncRepository.recordWebhookDelivery({
			deliveryId: deliveryId(21),
			eventName: 'installation',
			action: 'unsuspend',
			installation: {
				externalInstallationId: BigInt(PRIMARY_INSTALLATION_ID),
				suspendedAt: null,
			},
		})

		expect(await findSource(primary.repositoryId)).toMatchObject({
			syncStatus: 'pending',
			syncFailureCode: null,
			syncFailureReason: null,
		})

		for (const request of syncRequests) await runRequest(request)

		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'healthy',
		})
	})

	test('collapses versions requested while the lease is held into one follow-up', async () => {
		const claim = await syncRepository.claimSync({
			...(await requestFor(primary.repositoryId)),
			leaseOwner: 'lease-owner',
			leaseAcquiredAt: new Date(),
			leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
		})
		if (!claim) throw new Error('Failed to claim the repository lease')

		await recordPullRequestDelivery(deliveryId(31))
		await recordPullRequestDelivery(deliveryId(32))

		const followUp = await syncRepository.finalizeSync({
			repositoryId: claim.repositoryId,
			authorityGeneration: claim.authorityGeneration,
			requestedSyncVersion: claim.requestedSyncVersion,
			leaseOwner: claim.leaseOwner,
			storagePath: '/var/lib/tessera/repositories/notes.git',
			defaultBranch: 'main',
			externalRepositoryNodeId: 'repository-node',
			ownerLogin: 'tessera-org',
			name: 'notes',
			fullName: 'tessera-org/notes',
			sourceUrl: 'https://github.com/tessera-org/notes',
			sourceDefaultBranch: 'main',
			pullRequestSyncCursorAt: new Date(),
			projectedNumbers: [],
			projectedShas: [],
			completedAt: new Date(),
			nextSyncAt: new Date(Date.now() + 60 * 60_000),
		})

		// Two deliveries arrived mid-run and both are answered by one follow-up at
		// the newest version rather than by one job each.
		expect(followUp).toMatchObject({
			requestedSyncVersion: claim.requestedSyncVersion + 2,
		})
	})

	test('re-arms a processed delivery so replay reconciles its target again', async () => {
		await recordPullRequestDelivery(deliveryId(41))
		await runDueReconciliations()

		expect(await findDelivery(deliveryId(41))).toMatchObject({
			status: 'processed',
		})

		expect(await replayService.replayDelivery(deliveryId(41))).toBeTruthy()

		// Bumping the version alone would reconcile the repository without ever
		// revisiting this delivery's pull request, so the delivery is re-armed too.
		expect(await findDelivery(deliveryId(41))).toMatchObject({
			status: 'received',
			processedAt: null,
		})
		// The wakeup carries only the version; the provenance that makes it a
		// replay lives on the source row the claim will read.
		expect(await findSource(primary.repositoryId)).toMatchObject({
			requestedSyncTrigger: 'replay',
			requestedReplayDeliveryId: deliveryId(41),
		})
		expect(enqueue).toHaveBeenCalledWith(
			expect.objectContaining({ repositoryId: primary.repositoryId })
		)
	})

	test('replays a delivery still waiting to be processed', async () => {
		await recordPullRequestDelivery(deliveryId(42))

		expect(await findDelivery(deliveryId(42))).toMatchObject({
			status: 'received',
		})
		expect(await replayService.replayDelivery(deliveryId(42))).toBeTruthy()
		expect(await findDelivery(deliveryId(42))).toMatchObject({
			status: 'received',
		})
	})

	test('replays a delivery a terminal failure settled', async () => {
		await recordPullRequestDelivery(deliveryId(42))
		// Reached the way production reaches it: a version no repeat of the same
		// request can satisfy settles itself and the deliveries it would have
		// consumed, which is what makes them replayable later.
		getRepositoryReconciliation.mockRejectedValue(
			new GitHubSyncExternalServiceError({
				failureClass: 'validation',
				failureCode: 'provider_schema_mismatch',
				scope: 'repository',
			})
		)

		await expect(runDueReconciliations()).rejects.toThrow(
			'provider_schema_mismatch'
		)

		const source = await findSource(primary.repositoryId)

		expect(source).toMatchObject({
			completedSyncVersion: source?.requestedSyncVersion,
			syncFailureCode: 'provider_schema_mismatch',
		})
		expect(await findDelivery(deliveryId(42))).toMatchObject({
			status: 'failed',
			failureCode: 'provider_schema_mismatch',
		})
		// A settled version is never handed back, so the next scheduled pass has
		// to raise a new one rather than retry this one.
		expect(
			await syncRepository.requestDueReconciliations({
				limit: 25,
				now: new Date(Date.now() + 60 * 60_000),
			})
		).toEqual([
			expect.objectContaining({
				requestedSyncVersion: (source?.requestedSyncVersion ?? 0) + 1,
			}),
		])

		getRepositoryReconciliation.mockImplementation(() =>
			Promise.resolve(reconciliation(PRIMARY_EXTERNAL_REPOSITORY_ID))
		)

		expect(await replayService.replayDelivery(deliveryId(42))).toBeTruthy()
		expect(await findSource(primary.repositoryId)).toMatchObject({
			syncStatus: 'pending',
			syncFailureCode: null,
			syncFailureReason: null,
		})
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'pending',
			code: undefined,
			message: undefined,
		})
		expect(await findDelivery(deliveryId(42))).toMatchObject({
			status: 'received',
			failedAt: null,
			failureCode: null,
		})
	})

	test('refuses to replay a delivery received under another installation', async () => {
		await recordPullRequestDelivery(deliveryId(45))
		const rebound = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId: 7777n,
				accountNodeId: 'organization-node-7777',
				accountLogin: 'tessera-org',
				targetType: 'organization',
			})
			.returning({ id: gitHubInstallations.id })
		await db
			.update(repositoryExternalSources)
			.set({ installationId: rebound[0]?.id })
			.where(eq(repositoryExternalSources.repositoryId, primary.repositoryId))

		// The delivery describes an event the current authority never saw.
		expect(await replayService.replayDelivery(deliveryId(45))).toBeFalsy()
		expect(enqueue).not.toHaveBeenCalled()
	})

	test('refuses to replay a delivery into a blocked repository', async () => {
		await recordPullRequestDelivery(deliveryId(43))
		await db
			.update(repositoryExternalSources)
			.set({ syncStatus: 'blocked', syncFailureCode: 'missing_installation' })
			.where(eq(repositoryExternalSources.repositoryId, primary.repositoryId))

		// Replay is a reconciliation trigger, not a way around lost access.
		expect(await replayService.replayDelivery(deliveryId(43))).toBeFalsy()
		expect(enqueue).not.toHaveBeenCalled()
	})

	test('leaves entity and event counts unchanged under a replay storm', async () => {
		await recordPullRequestDelivery(deliveryId(44))
		await runDueReconciliations()

		const [mappings, events] = await countProjections()

		for (let replay = 0; replay < 5; replay += 1) {
			await replayService.replayDelivery(deliveryId(44))
			await drainSyncQueue()
		}

		expect(await countProjections()).toEqual([mappings, events])
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'healthy',
		})
	})

	test('keeps every stored diagnostic free of provider text', async () => {
		getRepositoryReconciliation.mockRejectedValue(
			Object.assign(new Error('Bad credentials for ghs_super-secret-token'), {
				status: 500,
			})
		)

		await expect(runDueReconciliations()).rejects.toThrow(
			'GitHub synchronization failed'
		)

		expect(
			JSON.stringify(
				[
					await findSource(primary.repositoryId),
					await listAttempts(primary.repositoryId),
					await db.query.gitHubWebhookDeliveries.findMany(),
				],
				(_key, value) => (typeof value === 'bigint' ? value.toString() : value)
			)
		).not.toContain('ghs_super-secret-token')
	})

	test('runs the newest version when an older job wakes the worker', async () => {
		// A wakeup names the version outstanding when it was raised; two more
		// deliveries arrive before the worker gets to it. The claim must take the
		// newest, and the attempt must describe that version rather than the job's.
		const stale = await requestFor(primary.repositoryId)
		await recordPullRequestDelivery(deliveryId(51))
		await recordPullRequestDelivery(deliveryId(52))

		const current = await findSource(primary.repositoryId)

		expect(current?.requestedSyncVersion).toBe(stale.requestedSyncVersion + 2)

		await runRequest(stale)

		expect(await listAttempts(primary.repositoryId)).toEqual([
			expect.objectContaining({
				requestedSyncVersion: current?.requestedSyncVersion,
				trigger: 'webhook',
				status: 'succeeded',
			}),
		])
		expect(await findSource(primary.repositoryId)).toMatchObject({
			completedSyncVersion: current?.requestedSyncVersion,
			syncStatus: 'succeeded',
		})
	})

	test('describes a replayed version as a replay even when an older job runs it', async () => {
		await recordPullRequestDelivery(deliveryId(53))
		const stale = await requestFor(primary.repositoryId)

		expect(await replayService.replayDelivery(deliveryId(53))).toBeTruthy()

		// The replay raised a newer version, and this older job is the one that
		// happens to claim it. Provenance follows the version, not the wakeup.
		await runRequest(stale)

		expect(await listAttempts(primary.repositoryId)).toEqual([
			expect.objectContaining({
				trigger: 'replay',
				replayDeliveryId: deliveryId(53),
			}),
		])
	})

	test('collapses concurrent replays of one delivery onto one run each', async () => {
		await recordPullRequestDelivery(deliveryId(54))
		await runDueReconciliations()

		const [mappings, events] = await countProjections()

		await Promise.all([
			replayService.replayDelivery(deliveryId(54)),
			replayService.replayDelivery(deliveryId(54)),
			replayService.replayDelivery(deliveryId(54)),
		])

		const requests = enqueue.mock.calls.map(
			([request]) => request as GitHubSyncRequest
		)
		enqueue.mockClear()

		// Genuinely concurrent replays each advance the version, and the repository
		// lease still serializes the runs they produce.
		expect(
			new Set(requests.map(request => request.requestedSyncVersion)).size
		).toBe(requests.length)

		await Promise.all(requests.map(request => runRequest(request)))

		expect(await countProjections()).toEqual([mappings, events])
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'healthy',
		})
	})

	test('settles an attempt a dead worker left open when the lease is reclaimed', async () => {
		const abandoned = await syncRepository.claimSync({
			...(await requestFor(primary.repositoryId)),
			leaseOwner: 'dead-worker',
			leaseAcquiredAt: new Date(Date.now() - 60 * 60_000),
			leaseExpiresAt: new Date(Date.now() - 30 * 60_000),
		})
		if (!abandoned) throw new Error('Failed to claim the repository lease')

		await syncRepository.startSyncAttempt({
			repositoryId: abandoned.repositoryId,
			authorityGeneration: abandoned.authorityGeneration,
			requestedSyncVersion: abandoned.requestedSyncVersion,
			installationId: abandoned.installationId,
			trigger: 'scheduled',
			startedAt: new Date(Date.now() - 60 * 60_000),
		})

		// Nothing else ever closes that row: the worker is gone and the lease it
		// held simply expires. Taking the lease is when that becomes knowable.
		await runDueReconciliations()

		expect(
			(await listAttempts(primary.repositoryId)).map(attempt => [
				attempt.status,
				attempt.failureCode,
			])
		).toEqual([
			['interrupted', 'lease_reclaimed'],
			['succeeded', null],
		])
		expect(await findSyncHealth(primary.repositoryId)).toMatchObject({
			state: 'healthy',
			failureRate24h: 0,
		})
	})

	test('defers an installation whose last permitted request succeeded', async () => {
		const resetAt = new Date(Date.now() + 20 * 60_000)
		getRepositoryReconciliation.mockImplementation(() =>
			Promise.resolve({
				...reconciliation(PRIMARY_EXTERNAL_REPOSITORY_ID),
				rateLimit: { remaining: 0, resetAt },
			})
		)

		await runDueReconciliations()

		// The run succeeded, so nothing failed and nothing would otherwise record a
		// limit — but the budget is spent, and the next repository under this
		// installation would collect the refusal.
		expect(
			(
				await db.query.gitHubInstallations.findFirst({
					where: eq(gitHubInstallations.id, primary.installationId),
				})
			)?.rateLimitedUntil?.getTime()
		).toBe(resetAt.getTime())
		expect(
			await syncRepository.requestDueReconciliations({
				limit: 25,
				now: new Date(),
			})
		).toEqual([])
	})

	test('reads sync health straight from what the run recorded', async () => {
		await recordPullRequestDelivery(deliveryId(55))
		await runDueReconciliations()

		const facts = await healthRepository.findFacts({
			now: new Date(),
			repositoryId: primary.repositoryId,
		})

		expect(facts).toMatchObject({
			syncStatus: 'succeeded',
			pendingDeliveryCount: 0,
			retryCount24h: 0,
			terminalCount24h: 0,
			completedCount24h: 1,
			latestAttemptStatus: 'succeeded',
			lastReconciliationDurationMs: expect.any(Number),
		})
		expect(facts?.lastSyncSucceededAt).toBeTruthy()
	})

	test('counts only deliveries still waiting as pending', async () => {
		await recordPullRequestDelivery(deliveryId(56))

		const pending = await healthRepository.findFacts({
			now: new Date(),
			repositoryId: primary.repositoryId,
		})

		expect(pending?.pendingDeliveryCount).toBe(1)
		// A timestamp read back as a bare string would be parsed as local time and
		// report a lag off by the server's offset, so the derived lag is checked
		// against the clock rather than only for existence.
		expect(pending?.oldestPendingDeliveryAt).toBeInstanceOf(Date)
		expect(
			toRepositorySyncHealth(pending ?? MISSING_FACTS, {
				now: new Date(),
				syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
			}).deliveryLagSeconds
		).toBeLessThan(60)

		await runDueReconciliations()

		expect(
			(
				await healthRepository.findFacts({
					now: new Date(),
					repositoryId: primary.repositoryId,
				})
			)?.pendingDeliveryCount
		).toBe(0)
	})

	test('reports no health facts for a repository GitHub does not drive', async () => {
		await db
			.update(repositoryExternalSources)
			.set({ mirrorMode: 'imported' })
			.where(eq(repositoryExternalSources.repositoryId, primary.repositoryId))

		expect(
			await healthRepository.findFacts({
				now: new Date(),
				repositoryId: primary.repositoryId,
			})
		).toBeUndefined()
	})

	async function runDueReconciliations() {
		await db.update(repositoryExternalSources).set({ nextSyncAt: new Date() })
		enqueue.mockClear()
		await processor.process(
			createJob(GITHUB_SYNC_DISPATCHER_JOB, { type: 'dispatcher' })
		)
		await drainSyncQueue()
	}

	async function drainSyncQueue() {
		const requests = enqueue.mock.calls.map(
			([request]) => request as GitHubSyncRequest
		)
		enqueue.mockClear()

		for (const request of requests) await runRequest(request)
	}

	async function runRequest(request: GitHubSyncRequest) {
		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
	}

	function createJob(name: string, data: GitHubSyncJobData) {
		return { name, data } as Job<GitHubSyncJobData>
	}

	async function requestFor(
		repositoryId: RepositoryId
	): Promise<GitHubSyncRequest> {
		const source = await findSource(repositoryId)
		if (!source) throw new Error('External source missing')

		return {
			repositoryId,
			authorityGeneration: source.authorityGeneration,
			requestedSyncVersion: source.requestedSyncVersion,
		}
	}

	async function findSource(repositoryId: RepositoryId) {
		return await db.query.repositoryExternalSources.findFirst({
			where: eq(repositoryExternalSources.repositoryId, repositoryId),
		})
	}

	async function findDelivery(id: GitHubWebhookDeliveryId) {
		return await db.query.gitHubWebhookDeliveries.findFirst({
			where: eq(gitHubWebhookDeliveries.id, id),
		})
	}

	async function listAttempts(repositoryId: RepositoryId) {
		return await db.query.gitHubSyncAttempts.findMany({
			where: eq(gitHubSyncAttempts.repositoryId, repositoryId),
			orderBy: (attempt, { asc }) => asc(attempt.attemptNumber),
		})
	}

	async function findSyncHealth(repositoryId: RepositoryId) {
		const now = new Date()
		const facts = await healthRepository.findFacts({ now, repositoryId })
		if (!facts) throw new Error('Sync health facts missing')

		return toRepositorySyncHealth(facts, {
			now,
			syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
		})
	}

	async function countProjections(): Promise<[number, number]> {
		return [
			(await db.query.gitHubPullRequestMappings.findMany()).length,
			(await db.query.pullRequestEvents.findMany()).length,
		]
	}

	async function recordPullRequestDelivery(id: GitHubWebhookDeliveryId) {
		await syncRepository.recordWebhookDelivery({
			deliveryId: id,
			eventName: 'pull_request',
			action: 'synchronize',
			installation: {
				externalInstallationId: BigInt(PRIMARY_INSTALLATION_ID),
			},
			externalRepositoryNodeId: 'repository-node',
			externalRepositoryNumericId: BigInt(PRIMARY_EXTERNAL_REPOSITORY_ID),
			subjectNodeId: 'pull-request-node',
			subjectNumber: 1,
		})
	}

	function deliveryId(offset: number): GitHubWebhookDeliveryId {
		return `00000000-0000-4000-8000-${offset.toString().padStart(12, '0')}` as GitHubWebhookDeliveryId
	}

	function reconciliation(externalRepositoryId: number) {
		return {
			repository: {
				nodeId: 'repository-node',
				numericId: BigInt(externalRepositoryId),
				ownerLogin: 'tessera-org',
				name: 'notes',
				fullName: 'tessera-org/notes',
				htmlUrl: 'https://github.com/tessera-org/notes',
				cloneUrl: 'https://github.com/tessera-org/notes.git',
				defaultBranch: 'main',
			},
			pullRequests: [pullRequestSnapshot()],
			pullRequestCursorAt: new Date('2026-08-11T11:00:00Z'),
		}
	}

	function pullRequestSnapshot(): GitHubSyncPullRequest {
		return {
			nodeId: 'pull-request-node',
			numericId: 900n,
			number: 1,
			htmlUrl: 'https://github.com/tessera-org/notes/pull/1',
			title: 'Add notes',
			body: '',
			state: 'open',
			draft: false,
			labels: [],
			assignees: [],
			author: {
				nodeId: 'actor-marta',
				numericId: 500n,
				login: 'marta',
				type: 'user',
			},
			sourceBranch: 'feature',
			targetBranch: 'main',
			headRepositoryNodeId: 'repository-node',
			baseRepositoryNodeId: 'repository-node',
			headSha: HEAD_SHA,
			baseSha: BASE_SHA,
			createdAt: new Date('2026-08-11T09:00:00Z'),
			updatedAt: new Date('2026-08-11T10:00:00Z'),
		}
	}

	async function createOwner(username: string): Promise<UserId> {
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

		return createdUser.id
	}

	async function createMirror({
		externalInstallationId,
		externalRepositoryId,
		slug,
	}: {
		externalInstallationId: number
		externalRepositoryId: number
		slug: string
	}): Promise<MirrorFixture> {
		const [repository] = await db
			.insert(repositories)
			.values({
				slug: slug as RepositorySlug,
				name: slug as RepositoryName,
				visibility: 'public',
				ownerUserId,
				defaultBranch: 'main',
				storagePath: `/var/lib/tessera/repositories/${slug}.git`,
			})
			.returning({ id: repositories.id })
		if (!repository) throw new Error('Failed to create repository')

		const [installation] = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId: BigInt(externalInstallationId),
				accountNodeId: `organization-node-${externalInstallationId}`,
				accountLogin: 'tessera-org',
				targetType: 'organization',
			})
			.returning({ id: gitHubInstallations.id })
		if (!installation) throw new Error('Failed to create GitHub installation')

		await db.insert(repositoryExternalSources).values({
			repositoryId: repository.id,
			provider: 'github',
			installationId: installation.id,
			externalRepositoryNodeId: `repository-node-${externalRepositoryId}`,
			externalRepositoryId: BigInt(externalRepositoryId),
			ownerLogin: 'tessera-org',
			name: slug,
			fullName: `tessera-org/${slug}`,
			sourceUrl: `https://github.com/tessera-org/${slug}`,
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'pending',
			requestedSyncVersion: 1,
			nextSyncAt: new Date(),
		})

		return { repositoryId: repository.id, installationId: installation.id }
	}

	async function resetIntegrationDatabase() {
		await db.delete(gitHubSyncAttempts)
		await db.delete(gitHubPullRequestEventMappings)
		await db.delete(gitHubPullRequestMappings)
		await db.delete(gitHubWebhookDeliveries)
		await db.delete(pullRequestEvents)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(gitHubActors)
		await db.delete(gitHubInstallations)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})

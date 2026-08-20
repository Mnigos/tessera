import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { ChecksModule } from '@modules/checks'
import { GitHubSyncProcessor } from '@modules/github-sync/application/github-sync.processor'
import { GitHubWebhookService } from '@modules/github-sync/application/github-webhook.service'
import { GitHubAppAuthService } from '@modules/github-sync/infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '@modules/github-sync/infrastructure/github-sync.client'
import type {
	GitHubChecksSnapshot,
	GitHubSyncActor,
	GitHubSyncCheckRun,
	GitHubSyncCheckSuite,
	GitHubSyncCommitStatus,
	GitHubSyncPullRequest,
} from '@modules/github-sync/infrastructure/github-sync.client.types'
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
import { GitHubWebhookController } from '@modules/github-sync/presentation/github-webhook.controller'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { CheckKind } from '@repo/contracts'
import { db } from '@repo/db/client'
import {
	account,
	checkObservations,
	checks,
	gitHubActors,
	gitHubCheckRunMappings,
	gitHubCheckSuiteMappings,
	gitHubCommitStatusMappings,
	gitHubInstallations,
	gitHubPullRequestCommentMappings,
	gitHubPullRequestEventMappings,
	gitHubPullRequestMappings,
	gitHubPullRequestReviewerRequestMappings,
	gitHubPullRequestReviewMappings,
	gitHubPullRequestThreadMappings,
	gitHubWebhookDeliveries,
	pullRequestComments,
	pullRequestEvents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	repositories,
	repositoryCollaborators,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import type { Job } from 'bullmq'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
/** The head the pull request moves to; results on `HEAD_SHA` must survive it. */
const MOVED_HEAD_SHA = 'c'.repeat(40)
/** Commits only a delivery ever names, so no reconciliation page reports them. */
const RUN_DELIVERY_SHA = 'd'.repeat(40)
const SUITE_DELIVERY_SHA = 'e'.repeat(40)
const STATUS_DELIVERY_SHA = 'f'.repeat(40)
const WEBHOOK_SECRET = 'test-github-webhook-secret'
const EXTERNAL_REPOSITORY_ID = 4242
const EXTERNAL_INSTALLATION_ID = 8888
const PULL_REQUEST_URL = 'https://github.com/tessera-org/notes/pull/1'
/** Keeps every commit's provider identities distinct without hiding them. */
const SHA_IDENTITY_OFFSETS: Record<string, bigint> = {
	[MOVED_HEAD_SHA]: 1000n,
	[RUN_DELIVERY_SHA]: 2000n,
	[SUITE_DELIVERY_SHA]: 3000n,
	[STATUS_DELIVERY_SHA]: 4000n,
}
const SUITE_CREATED_AT = new Date('2026-08-01T09:00:00Z')
const RUN_STARTED_AT = new Date('2026-08-01T09:01:00Z')
const RUN_COMPLETED_AT = new Date('2026-08-01T09:04:00Z')
const STATUS_CREATED_AT = new Date('2026-08-01T09:05:00Z')
const LATER_STATUS_CREATED_AT = new Date('2026-08-01T09:09:00Z')

const authorActor: GitHubSyncActor = {
	nodeId: 'actor-marta',
	numericId: 500n,
	login: 'marta',
	type: 'user',
}
const statusActor: GitHubSyncActor = {
	nodeId: 'actor-coverage-bot',
	numericId: 600n,
	login: 'coverage-bot',
	type: 'bot',
	htmlUrl: 'https://github.com/apps/coverage-bot',
}
const checksApp = {
	nodeId: 'app-node',
	numericId: 15n,
	slug: 'github-actions',
	name: 'GitHub Actions',
	htmlUrl: 'https://github.com/apps/github-actions',
}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ChecksSummaryResponse {
	headSha: string
	overall: string
	counts: Record<string, number>
	lastResultAt?: string
	headIsCurrent: boolean
}

interface ChecksListResponse {
	checks: {
		kind: string
		context: string
		state: string
		rawStatus?: string
		rawConclusion?: string
		provider: { kind: string; name: string; appSlug?: string; url?: string }
		targetUrl?: string
		outputTitle?: string
		durationMs?: number
	}[]
	headSha: string
	headIsCurrent: boolean
}

interface PullRequestDetailResponse {
	checksSummary?: ChecksSummaryResponse
}

interface PullRequestListResponse {
	pullRequests: { number: number; checksSummary?: ChecksSummaryResponse }[]
}

interface ComparisonResponse {
	commits: { sha: string; checksSummary?: ChecksSummaryResponse }[]
}

interface CheckStream {
	kind: CheckKind
	context: string
	sha: string
	states: string[]
}

describe('GitHub checks sync integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let processor: GitHubSyncProcessor
	let enqueue: ReturnType<typeof vi.fn>
	let compareRepositoryRefs: ReturnType<typeof vi.fn>
	let getChecksForRef: ReturnType<typeof vi.fn>
	let snapshots: Map<string, GitHubChecksSnapshot>
	let reconciledPullRequests: GitHubSyncPullRequest[]
	let owner: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		enqueue = vi.fn().mockResolvedValue(undefined)
		compareRepositoryRefs = vi.fn()
		getChecksForRef = vi.fn((({ ref }: { ref: string }) =>
			Promise.resolve(
				snapshots.get(ref) ?? { sha: ref, suites: [], runs: [], statuses: [] }
			)) satisfies GitHubSyncClient['getChecksForRef'])
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
			controllers: [GitHubWebhookController],
			providers: [
				GitHubWebhookService,
				GitHubSyncProcessor,
				GitHubSyncRepository,
				GitHubSyncChecksRepository,
				GitHubSyncConversationsRepository,
				{ provide: GitHubSyncQueue, useValue: { enqueue } },
				{
					provide: GitHubAppAuthService,
					useValue: {
						getInstallationToken: vi.fn().mockResolvedValue({
							token: 'installation-token',
							expiresAt: new Date('2026-08-01T12:00:00Z'),
						}),
					},
				},
				{
					provide: GitHubSyncClient,
					useValue: {
						getChecksForRef,
						getPullRequestConversation: vi.fn(() =>
							Promise.resolve({
								issueComments: [],
								reviewComments: [],
								reviews: [],
								requestedReviewers: [],
								reviewThreads: [],
							})
						),
						getRepositoryReconciliation: vi.fn(() =>
							Promise.resolve({
								repository: {
									nodeId: 'repository-node',
									numericId: BigInt(EXTERNAL_REPOSITORY_ID),
									ownerLogin: 'tessera-org',
									name: 'notes',
									fullName: 'tessera-org/notes',
									htmlUrl: 'https://github.com/tessera-org/notes',
									cloneUrl: 'https://github.com/tessera-org/notes.git',
									defaultBranch: 'main',
								},
								pullRequests: reconciledPullRequests,
								pullRequestCursorAt: new Date('2026-08-01T11:00:00Z'),
							})
						),
					},
				},
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
				importRepository: vi.fn(({ storagePath }) =>
					Promise.resolve({ storagePath, defaultBranch: 'main' })
				),
				listRepositoryRefs: vi.fn().mockResolvedValue({
					branches: [
						{
							type: 'branch',
							name: 'main',
							qualifiedName: 'refs/heads/main',
							target: BASE_SHA,
						},
					],
					tags: [],
				}),
				compareRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter, { rawBody: true })
		processor = moduleRef.get(GitHubSyncProcessor)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		enqueue.mockClear()
		getChecksForRef.mockClear()
		compareRepositoryRefs.mockReset().mockResolvedValue(comparison())
		snapshots = new Map([[HEAD_SHA, fullSnapshot(HEAD_SHA)]])
		reconciledPullRequests = [pullRequestSnapshot(HEAD_SHA)]
		owner = await createIntegrationUser('maya')
		await createMirroredRepository()
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('projects suites, runs, and statuses as native checks and provider mappings', async () => {
		await runProjection()

		expect(await listCheckStreams()).toEqual([
			{
				kind: 'check_run',
				context: 'build',
				sha: HEAD_SHA,
				states: ['success'],
			},
			{
				kind: 'status',
				context: 'ci/coverage',
				sha: HEAD_SHA,
				states: ['success'],
			},
			{
				kind: 'status',
				context: 'ci/security',
				sha: HEAD_SHA,
				states: ['failure'],
			},
			{
				kind: 'check_run',
				context: 'deploy',
				sha: HEAD_SHA,
				states: ['failure'],
			},
			{ kind: 'check_run', context: 'lint', sha: HEAD_SHA, states: ['queued'] },
		])

		// GitHub said `action_required` and `error`; both fail closed while the value
		// GitHub actually wrote stays readable on the observation.
		expect(await findObservations('deploy')).toEqual([
			expect.objectContaining({
				state: 'failure',
				rawStatus: 'completed',
				rawConclusion: 'action_required',
			}),
		])
		expect(await findObservations('ci/security', 'status')).toEqual([
			expect.objectContaining({
				state: 'failure',
				rawStatus: 'error',
				rawConclusion: null,
			}),
		])
		expect(await findObservations('build')).toEqual([
			expect.objectContaining({
				state: 'success',
				startedAt: RUN_STARTED_AT,
				completedAt: RUN_COMPLETED_AT,
				outputTitle: 'Build passed',
				outputSummary: 'Compiled 42 files',
			}),
		])

		expect(await db.query.gitHubCheckSuiteMappings.findMany()).toEqual([
			expect.objectContaining({
				externalNodeId: 'suite-node',
				externalNumericId: 700n,
				headSha: HEAD_SHA,
				rawStatus: 'completed',
				rawConclusion: 'action_required',
				appExternalNumericId: 15n,
				appSlug: 'github-actions',
				appName: 'GitHub Actions',
				providerMissingAt: null,
			}),
		])
		expect(await listRunMappingIdentities()).toEqual([
			{
				externalNodeId: 'run-build-node',
				externalNumericId: 802n,
				name: 'build',
			},
			{
				externalNodeId: 'run-deploy-node',
				externalNumericId: 803n,
				name: 'deploy',
			},
			{
				externalNodeId: 'run-lint-node',
				externalNumericId: 801n,
				name: 'lint',
			},
		])
		// A run resolves back to the suite that reported it, and every run mapping
		// names the native check it projected.
		expect(await db.query.gitHubCheckRunMappings.findMany()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: 'lint',
					checkSuiteMappingId: expect.any(String),
					checkId: expect.any(String),
					providerMissingAt: null,
				}),
			])
		)
		expect(await db.query.gitHubCommitStatusMappings.findMany()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalNodeId: 'status-coverage-node',
					externalNumericId: 901n,
					context: 'ci/coverage',
					rawState: 'success',
					sha: HEAD_SHA,
					creatorActorId: expect.any(String),
					checkObservationId: expect.any(String),
				}),
			])
		)
		expect(
			(await db.query.gitHubActors.findMany()).map(actor => actor.login)
		).toContain('coverage-bot')
	})

	test('appends nothing when the same snapshot is projected again', async () => {
		await runProjection()
		const streams = await listCheckStreams()
		const observations = await listObservations()

		await runProjection()

		expect(await listCheckStreams()).toEqual(streams)
		expect(await listObservations()).toEqual(observations)
		expect(await db.query.checks.findMany()).toHaveLength(5)
	})

	test('appends a page when a completed run is requeued without losing the result it replaced', async () => {
		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [checkSuite(HEAD_SHA)],
			runs: [successRun(HEAD_SHA)],
			statuses: [],
		})
		await runProjection()

		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [checkSuite(HEAD_SHA)],
			runs: [
				{
					...successRun(HEAD_SHA),
					status: 'queued',
					conclusion: undefined,
					startedAt: undefined,
					completedAt: undefined,
				},
			],
			statuses: [],
		})
		await runProjection()

		// One run identity is one logbook: the requeue is another page, and the page
		// that recorded the success is still there.
		expect(await findObservations('build')).toEqual([
			expect.objectContaining({ state: 'success', rawConclusion: 'success' }),
			expect.objectContaining({ state: 'queued', rawConclusion: null }),
		])
		// The same run identity joins the check it already had rather than opening
		// a second one.
		expect(await db.query.checks.findMany()).toHaveLength(1)
		expect(await findEffectiveCheck('build')).toMatchObject({ state: 'queued' })
		expect(await getChecksSummary()).toMatchObject({
			overall: 'pending',
			counts: expect.objectContaining({ queued: 1, success: 0 }),
		})
	})

	test('lets a new run id supersede the run it replaced while both stay on file', async () => {
		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [checkSuite(HEAD_SHA)],
			runs: [{ ...successRun(HEAD_SHA), conclusion: 'failure' }],
			statuses: [],
		})
		await runProjection()
		expect(await findEffectiveCheck('build')).toMatchObject({
			state: 'failure',
		})

		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [checkSuite(HEAD_SHA)],
			runs: [
				{ ...successRun(HEAD_SHA), conclusion: 'failure' },
				{
					...successRun(HEAD_SHA),
					nodeId: 'run-build-retry-node',
					numericId: 902n,
				},
			],
			statuses: [],
		})
		await runProjection()

		// Two checks compete for `build`; the newer run identity answers for the
		// context and the failing one keeps every page it wrote.
		expect(await listCheckStreams()).toEqual([
			{
				kind: 'check_run',
				context: 'build',
				sha: HEAD_SHA,
				states: ['failure'],
			},
			{
				kind: 'check_run',
				context: 'build',
				sha: HEAD_SHA,
				states: ['success'],
			},
		])
		expect(await findEffectiveCheck('build')).toMatchObject({
			state: 'success',
		})
		expect((await listChecksResponse(HEAD_SHA)).checks).toHaveLength(1)
	})

	test('keeps every status posted against a context and lets the newest one answer', async () => {
		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [],
			runs: [],
			// GitHub lists a context's statuses newest first.
			statuses: [failedCoverageStatus(HEAD_SHA), coverageStatus(HEAD_SHA)],
		})

		await runProjection()

		expect(await listCheckStreams()).toEqual([
			{
				kind: 'status',
				context: 'ci/coverage',
				sha: HEAD_SHA,
				states: ['success', 'failure'],
			},
		])
		expect(await findEffectiveCheck('ci/coverage')).toMatchObject({
			state: 'failure',
		})
		expect(await db.query.gitHubCommitStatusMappings.findMany()).toHaveLength(2)
	})

	test('keeps a commit status and a check run sharing a context distinct', async () => {
		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [checkSuite(HEAD_SHA)],
			runs: [{ ...successRun(HEAD_SHA), name: 'ci/coverage' }],
			statuses: [failedCoverageStatus(HEAD_SHA)],
		})

		await runProjection()

		expect(await listCheckStreams()).toEqual([
			{
				kind: 'check_run',
				context: 'ci/coverage',
				sha: HEAD_SHA,
				states: ['success'],
			},
			{
				kind: 'status',
				context: 'ci/coverage',
				sha: HEAD_SHA,
				states: ['failure'],
			},
		])
		expect((await listChecksResponse(HEAD_SHA)).checks).toEqual([
			expect.objectContaining({ kind: 'status', state: 'failure' }),
			expect.objectContaining({ kind: 'check_run', state: 'success' }),
		])
		expect(await getChecksSummary()).toMatchObject({
			overall: 'failure',
			counts: expect.objectContaining({ success: 1, failure: 1 }),
		})
	})

	test('projects every commit a signed check delivery names, including one no page reports', async () => {
		reconciledPullRequests = []
		snapshots.set(RUN_DELIVERY_SHA, fullSnapshot(RUN_DELIVERY_SHA))
		snapshots.set(SUITE_DELIVERY_SHA, fullSnapshot(SUITE_DELIVERY_SHA))
		snapshots.set(STATUS_DELIVERY_SHA, {
			sha: STATUS_DELIVERY_SHA,
			suites: [],
			runs: [],
			statuses: [coverageStatus(STATUS_DELIVERY_SHA)],
		})

		expect(
			(await postWebhook(crypto.randomUUID(), 'check_run', checkRunDelivery()))
				.status
		).toBe(202)
		expect(
			(
				await postWebhook(
					crypto.randomUUID(),
					'check_suite',
					checkSuiteDelivery()
				)
			).status
		).toBe(202)
		expect(
			(await postWebhook(crypto.randomUUID(), 'status', commitStatusDelivery()))
				.status
		).toBe(202)
		await drainSyncQueue()

		// No reconciliation page reports these commits, so the deliveries are the
		// only reason any of them was read at all.
		expect(await listProjectedShas()).toEqual([
			RUN_DELIVERY_SHA,
			SUITE_DELIVERY_SHA,
			STATUS_DELIVERY_SHA,
		])
		// A check delivery carries no pull request number, so it is consumed
		// through the commit it named rather than by the subjectless rule.
		expect(await listDeliveryProvenance()).toEqual([
			{
				eventName: 'check_run',
				targetResourceKind: 'check_run',
				targetSha: RUN_DELIVERY_SHA,
				targetContext: 'lint',
				status: 'processed',
			},
			{
				eventName: 'check_suite',
				targetResourceKind: 'check_suite',
				targetSha: SUITE_DELIVERY_SHA,
				targetContext: null,
				status: 'processed',
			},
			{
				eventName: 'status',
				targetResourceKind: 'commit_status',
				targetSha: STATUS_DELIVERY_SHA,
				targetContext: 'ci/coverage',
				status: 'processed',
			},
		])
	})

	test('treats a repeated check delivery identifier as a no-op', async () => {
		const deliveryId = crypto.randomUUID()
		await postWebhook(deliveryId, 'check_run', checkRunDelivery())
		const requestedSyncVersion = await findRequestedSyncVersion()

		const repeated = await postWebhook(
			deliveryId,
			'check_run',
			checkRunDelivery()
		)

		expect(repeated.status).toBe(202)
		expect(await repeated.json()).toEqual({ accepted: true, duplicate: true })
		expect(await db.query.gitHubWebhookDeliveries.findMany()).toHaveLength(1)
		// The repeat re-enqueues the sync the original delivery is still waiting
		// for, and asks for no work of its own.
		expect(await findRequestedSyncVersion()).toBe(requestedSyncVersion)
	})

	test('refuses a check delivery whose signature does not verify', async () => {
		const rejected = await postWebhook(
			crypto.randomUUID(),
			'check_run',
			checkRunDelivery(),
			'wrong-secret'
		)

		expect(rejected.status).toBe(401)
		expect(await db.query.gitHubWebhookDeliveries.findMany()).toEqual([])
		expect(enqueue).not.toHaveBeenCalled()
	})

	test('keeps results of a commit the pull request moved past and reports the new head', async () => {
		await runProjection()
		const observations = await listObservations()

		reconciledPullRequests = [pullRequestSnapshot(MOVED_HEAD_SHA)]
		snapshots.set(MOVED_HEAD_SHA, {
			sha: MOVED_HEAD_SHA,
			suites: [checkSuite(MOVED_HEAD_SHA)],
			runs: [successRun(MOVED_HEAD_SHA)],
			statuses: [],
		})
		await runProjection()

		// Nothing computed against the old head is rewritten; it just stops speaking
		// for the pull request.
		expect(
			(await listObservations()).filter(observation =>
				observations.some(existing => existing.id === observation.id)
			)
		).toEqual(observations)
		expect(await getChecksSummary()).toMatchObject({
			headSha: MOVED_HEAD_SHA,
			overall: 'success',
			headIsCurrent: true,
		})
		expect(await listChecksResponse(MOVED_HEAD_SHA)).toMatchObject({
			headSha: MOVED_HEAD_SHA,
			headIsCurrent: true,
		})

		const moved = await listChecksResponse(HEAD_SHA)
		expect(moved.headIsCurrent).toBeFalsy()
		expect(moved.checks).toHaveLength(5)
	})

	test('carries a rollup for every commit the comparison lists', async () => {
		compareRepositoryRefs.mockResolvedValue(
			comparison([
				{ sha: BASE_SHA, shortSha: BASE_SHA.slice(0, 7), summary: 'Base' },
				{ sha: HEAD_SHA, shortSha: HEAD_SHA.slice(0, 7), summary: 'Head' },
			])
		)
		await runProjection()

		expect((await getComparison()).commits).toEqual([
			expect.objectContaining({
				sha: BASE_SHA,
				checksSummary: expect.objectContaining({
					overall: 'none',
					headIsCurrent: false,
				}),
			}),
			expect.objectContaining({
				sha: HEAD_SHA,
				checksSummary: expect.objectContaining({
					overall: 'failure',
					headIsCurrent: true,
				}),
			}),
		])
	})

	test('never deletes native results GitHub stopped reporting', async () => {
		await runProjection()
		const streams = await listCheckStreams()
		const observations = await listObservations()

		snapshots.set(HEAD_SHA, {
			sha: HEAD_SHA,
			suites: [],
			runs: [],
			statuses: [],
		})
		await runProjection()

		expect(await listCheckStreams()).toEqual(streams)
		expect(await listObservations()).toEqual(observations)
		// A pruned run is still a run that happened, so the mapping records the
		// absence and nothing else does.
		expect(
			(await db.query.gitHubCheckRunMappings.findMany()).map(
				mapping => mapping.providerMissingAt
			)
		).toEqual([expect.any(Date), expect.any(Date), expect.any(Date)])
		expect(
			(await db.query.gitHubCommitStatusMappings.findMany()).map(
				mapping => mapping.providerMissingAt
			)
		).toEqual([expect.any(Date), expect.any(Date)])
		expect(
			(await db.query.gitHubCheckSuiteMappings.findMany()).map(
				mapping => mapping.providerMissingAt
			)
		).toEqual([expect.any(Date)])
	})

	test('serves full rows with provider identity beside the rollups on get and list', async () => {
		await runProjection()

		expect(await getChecksSummary()).toEqual({
			headSha: HEAD_SHA,
			overall: 'failure',
			counts: {
				queued: 1,
				pending: 0,
				success: 2,
				failure: 2,
				neutral: 0,
				canceled: 0,
				skipped: 0,
				timed_out: 0,
				stale: 0,
			},
			lastResultAt: expect.any(String),
			headIsCurrent: true,
		})
		expect((await listPullRequests()).pullRequests).toEqual([
			expect.objectContaining({
				number: 1,
				checksSummary: expect.objectContaining({
					headSha: HEAD_SHA,
					overall: 'failure',
				}),
			}),
		])

		const listed = await listChecksResponse(HEAD_SHA)
		// Worst outcome first, so the panel leads with what is broken.
		expect(
			listed.checks.map(check => `${check.context}:${check.state}`)
		).toEqual([
			'ci/security:failure',
			'deploy:failure',
			'lint:queued',
			'build:success',
			'ci/coverage:success',
		])
		expect(listed.checks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					context: 'build',
					provider: {
						kind: 'github',
						name: 'GitHub Actions',
						appSlug: 'github-actions',
						url: 'https://github.com/apps/github-actions',
					},
					targetUrl: 'https://github.com/tessera-org/notes/runs/802',
					outputTitle: 'Build passed',
					durationMs: 180_000,
				}),
				// A status is posted by an account, so it reads under that account.
				expect.objectContaining({
					context: 'ci/coverage',
					provider: {
						kind: 'github',
						name: 'coverage-bot',
						url: 'https://github.com/apps/coverage-bot',
					},
					targetUrl: 'https://ci.example.com/coverage/901',
				}),
			])
		)
	})

	test('answers with a synthesized none rollup for a pull request nothing reported on', async () => {
		snapshots.clear()
		await runProjection()

		expect(await getChecksSummary()).toMatchObject({
			headSha: HEAD_SHA,
			overall: 'none',
			counts: expect.objectContaining({ success: 0, failure: 0 }),
			headIsCurrent: true,
		})
		expect(await getChecksSummary()).not.toHaveProperty('lastResultAt')
		expect(await listChecksResponse(HEAD_SHA)).toMatchObject({
			checks: [],
			headSha: HEAD_SHA,
			headIsCurrent: true,
		})
	})

	test('commits nothing when synchronization authority changes mid-projection', async () => {
		getChecksForRef.mockImplementationOnce(async ({ ref }: { ref: string }) => {
			await db
				.update(repositoryExternalSources)
				.set({ authorityGeneration: 99 })

			return (
				snapshots.get(ref) ?? { sha: ref, suites: [], runs: [], statuses: [] }
			)
		})

		await expect(runProjection()).rejects.toThrow(
			'GitHub synchronization authority changed'
		)

		expect(await db.query.checks.findMany()).toEqual([])
		expect(await listObservations()).toEqual([])
		expect(await db.query.gitHubCheckRunMappings.findMany()).toEqual([])
		expect(await db.query.gitHubCheckSuiteMappings.findMany()).toEqual([])
	})

	function pullRequestSnapshot(headSha: string): GitHubSyncPullRequest {
		return {
			nodeId: 'pull-request-node',
			numericId: 900n,
			number: 1,
			htmlUrl: PULL_REQUEST_URL,
			title: 'Rename the value',
			body: 'Renames the value',
			state: 'open',
			draft: false,
			labels: [],
			assignees: [],
			author: authorActor,
			sourceBranch: 'feature',
			targetBranch: 'main',
			baseRepositoryNodeId: 'repository-node',
			headRepositoryNodeId: 'repository-node',
			headSha,
			baseSha: BASE_SHA,
			createdAt: new Date('2026-08-01T09:00:00Z'),
			updatedAt: new Date('2026-08-01T10:30:00Z'),
		}
	}

	/** A representative mix: one run of every lifecycle stage plus both statuses. */
	function fullSnapshot(sha: string): GitHubChecksSnapshot {
		return {
			sha,
			suites: [checkSuite(sha)],
			runs: [queuedRun(sha), successRun(sha), actionRequiredRun(sha)],
			statuses: [coverageStatus(sha), securityStatus(sha)],
		}
	}

	function checkSuite(headSha: string): GitHubSyncCheckSuite {
		return {
			...providerIdentity(headSha, 'suite-node', 700n),
			headSha,
			status: 'completed',
			conclusion: 'action_required',
			app: checksApp,
			createdAt: SUITE_CREATED_AT,
			updatedAt: RUN_COMPLETED_AT,
		}
	}

	function queuedRun(headSha: string): GitHubSyncCheckRun {
		return {
			...providerIdentity(headSha, 'run-lint-node', 801n),
			...suiteReference(headSha),
			name: 'lint',
			headSha,
			status: 'queued',
			app: checksApp,
		}
	}

	function successRun(headSha: string): GitHubSyncCheckRun {
		return {
			...providerIdentity(headSha, 'run-build-node', 802n),
			...suiteReference(headSha),
			name: 'build',
			headSha,
			status: 'completed',
			conclusion: 'success',
			detailsUrl: 'https://github.com/tessera-org/notes/runs/802',
			outputTitle: 'Build passed',
			outputSummary: 'Compiled 42 files',
			app: checksApp,
			startedAt: RUN_STARTED_AT,
			completedAt: RUN_COMPLETED_AT,
		}
	}

	/** GitHub finished it without a conclusion Tessera can read as passing. */
	function actionRequiredRun(headSha: string): GitHubSyncCheckRun {
		return {
			...providerIdentity(headSha, 'run-deploy-node', 803n),
			...suiteReference(headSha),
			name: 'deploy',
			headSha,
			status: 'completed',
			conclusion: 'action_required',
			app: checksApp,
		}
	}

	function coverageStatus(sha: string): GitHubSyncCommitStatus {
		return {
			...providerIdentity(sha, 'status-coverage-node', 901n),
			context: 'ci/coverage',
			state: 'success',
			targetUrl: 'https://ci.example.com/coverage/901',
			description: 'Coverage held at 91%',
			creator: statusActor,
			createdAt: STATUS_CREATED_AT,
			updatedAt: STATUS_CREATED_AT,
		}
	}

	function failedCoverageStatus(sha: string): GitHubSyncCommitStatus {
		return {
			...coverageStatus(sha),
			...providerIdentity(sha, 'status-coverage-retry-node', 903n),
			state: 'failure',
			createdAt: LATER_STATUS_CREATED_AT,
			updatedAt: LATER_STATUS_CREATED_AT,
		}
	}

	function securityStatus(sha: string): GitHubSyncCommitStatus {
		return {
			...providerIdentity(sha, 'status-security-node', 902n),
			context: 'ci/security',
			state: 'error',
			creator: statusActor,
			createdAt: STATUS_CREATED_AT,
			updatedAt: STATUS_CREATED_AT,
		}
	}

	function suiteReference(headSha: string) {
		const { nodeId, numericId } = providerIdentity(headSha, 'suite-node', 700n)

		return { suiteNodeId: nodeId, suiteNumericId: numericId }
	}

	/**
	 * GitHub fixes a result's commit when it creates the result, so a run, a suite
	 * and a status identify one commit and never move to another. Every commit
	 * therefore gets provider identities of its own, and the base commit keeps the
	 * unadorned ones the assertions read.
	 */
	function providerIdentity(sha: string, nodeId: string, numericId: bigint) {
		const offset = SHA_IDENTITY_OFFSETS[sha] ?? 0n

		return {
			nodeId: offset ? `${nodeId}-${offset}` : nodeId,
			numericId: numericId + offset,
		}
	}

	function comparison(
		commits: { sha: string; shortSha: string; summary: string }[] = []
	) {
		return {
			baseSha: BASE_SHA,
			headSha: HEAD_SHA,
			mergeBaseSha: BASE_SHA,
			commits,
			files: [],
			isTruncated: false,
			commitsTruncated: false,
			commitLimit: 500,
			fileLimit: 300,
		}
	}

	function deliveryEnvelope() {
		return {
			installation: { id: EXTERNAL_INSTALLATION_ID },
			repository: { id: EXTERNAL_REPOSITORY_ID, node_id: 'repository-node' },
			sender: {
				id: Number(statusActor.numericId),
				node_id: statusActor.nodeId,
				login: statusActor.login,
				type: 'Bot',
			},
		}
	}

	function checkRunDelivery() {
		const { nodeId, numericId } = providerIdentity(
			RUN_DELIVERY_SHA,
			'run-lint-node',
			801n
		)

		return {
			...deliveryEnvelope(),
			action: 'completed',
			check_run: {
				id: Number(numericId),
				node_id: nodeId,
				head_sha: RUN_DELIVERY_SHA,
				name: 'lint',
			},
		}
	}

	function checkSuiteDelivery() {
		const { nodeId, numericId } = providerIdentity(
			SUITE_DELIVERY_SHA,
			'suite-node',
			700n
		)

		return {
			...deliveryEnvelope(),
			action: 'completed',
			check_suite: {
				id: Number(numericId),
				node_id: nodeId,
				head_sha: SUITE_DELIVERY_SHA,
			},
		}
	}

	/** A `status` event is flat: the posted status is the payload root. */
	function commitStatusDelivery() {
		const { nodeId, numericId } = providerIdentity(
			STATUS_DELIVERY_SHA,
			'status-coverage-node',
			901n
		)

		return {
			...deliveryEnvelope(),
			id: Number(numericId),
			node_id: nodeId,
			sha: STATUS_DELIVERY_SHA,
			context: 'ci/coverage',
		}
	}

	async function runProjection() {
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

		for (const request of requests)
			await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
	}

	function createJob(name: string, data: GitHubSyncJobData) {
		return { name, data } as Job<GitHubSyncJobData>
	}

	async function listCheckStreams(): Promise<CheckStream[]> {
		const rows = await db.query.checks.findMany({
			with: {
				observations: {
					orderBy: (observations, { asc }) => asc(observations.sequence),
				},
			},
		})

		return rows
			.map(row => ({
				kind: row.kind,
				context: row.context,
				sha: row.sha,
				states: row.observations.map(observation => observation.state),
			}))
			.sort((left, right) =>
				toStreamKey(left).localeCompare(toStreamKey(right))
			)
	}

	function toStreamKey({ context, kind, states }: CheckStream) {
		return `${context}:${kind}:${states.join(',')}`
	}

	/**
	 * Every observation in the ledger's own append order. `findMany` has no
	 * inherent order, so comparing two unordered reads with `toEqual` would fail
	 * on a reshuffle rather than on a change. The sequence is a single serial
	 * across the whole table, so it totally orders them.
	 */
	async function listObservations() {
		return await db.query.checkObservations.findMany({
			orderBy: (observation, { asc }) => asc(observation.sequence),
		})
	}

	async function findObservations(
		context: string,
		kind: CheckKind = 'check_run'
	) {
		const check = await db.query.checks.findFirst({
			where: (row, { and, eq }) =>
				and(eq(row.context, context), eq(row.kind, kind)),
			with: {
				observations: {
					orderBy: (observations, { asc }) => asc(observations.sequence),
				},
			},
		})

		return check?.observations
	}

	async function findEffectiveCheck(context: string) {
		const { checks: rows } = await listChecksResponse(HEAD_SHA)

		return rows.find(row => row.context === context)
	}

	async function listRunMappingIdentities() {
		const mappings = await db.query.gitHubCheckRunMappings.findMany()

		return mappings
			.map(({ externalNodeId, externalNumericId, name }) => ({
				externalNodeId,
				externalNumericId,
				name,
			}))
			.sort((left, right) => left.name.localeCompare(right.name))
	}

	async function listProjectedShas() {
		const rows = await db.query.checks.findMany()

		return [...new Set(rows.map(row => row.sha))].sort()
	}

	async function findRequestedSyncVersion() {
		const source = await db.query.repositoryExternalSources.findFirst()

		return source?.requestedSyncVersion
	}

	async function listDeliveryProvenance() {
		const deliveries = await db.query.gitHubWebhookDeliveries.findMany({
			orderBy: (delivery, { asc }) => asc(delivery.receivedAt),
		})

		return deliveries.map(delivery => ({
			eventName: delivery.eventName,
			targetResourceKind: delivery.targetResourceKind,
			targetSha: delivery.targetSha,
			targetContext: delivery.targetContext,
			status: delivery.status,
		}))
	}

	async function getChecksSummary() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/maya/notes/pulls/1',
			{ headers: owner.headers }
		)

		return ((await response.json()) as PullRequestDetailResponse).checksSummary
	}

	async function listChecksResponse(expectedHeadSha: string) {
		const response = await adapter.hono.request(
			`http://localhost/repositories/maya/notes/pulls/1/checks?${new URLSearchParams({ expectedHeadSha })}`,
			{ headers: owner.headers }
		)

		return (await response.json()) as ChecksListResponse
	}

	async function listPullRequests() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/maya/notes/pulls',
			{ headers: owner.headers }
		)

		return (await response.json()) as PullRequestListResponse
	}

	async function getComparison() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/maya/notes/pulls/1/comparison',
			{ headers: owner.headers }
		)

		return (await response.json()) as ComparisonResponse
	}

	function postWebhook(
		deliveryId: string,
		eventName: string,
		payload: object,
		secret = WEBHOOK_SECRET
	) {
		const body = JSON.stringify(payload)
		const headers = new Headers({
			'content-type': 'application/json',
			'x-github-delivery': deliveryId,
			'x-github-event': eventName,
			'x-hub-signature-256': `sha256=${createHmac('sha256', secret)
				.update(body)
				.digest('hex')}`,
		})

		return adapter.hono.request('http://localhost/webhooks/github', {
			method: 'POST',
			headers,
			body,
		})
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
			`better-auth.session_token=${token}.${await makeSignature(token, 'test-auth-secret')}`
		)

		return { id: createdUser.id, headers, username }
	}

	async function createMirroredRepository() {
		const response = await adapter.hono.request(
			'http://localhost/repositories',
			{
				method: 'POST',
				headers: new Headers([
					...owner.headers,
					['content-type', 'application/json'],
				]),
				body: JSON.stringify({
					name: 'Notes',
					slug: 'notes',
					visibility: 'public',
				}),
			}
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		const repository = await db.query.repositories.findFirst()
		if (!repository) throw new Error('Repository missing')

		const [installation] = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId: BigInt(EXTERNAL_INSTALLATION_ID),
				accountNodeId: 'organization-node',
				accountLogin: 'tessera-org',
				targetType: 'organization',
			})
			.returning({ id: gitHubInstallations.id })
		if (!installation) throw new Error('Failed to create GitHub installation')

		await db.insert(repositoryExternalSources).values({
			repositoryId: repository.id,
			provider: 'github',
			installationId: installation.id,
			externalRepositoryNodeId: 'repository-node',
			externalRepositoryId: BigInt(EXTERNAL_REPOSITORY_ID),
			ownerLogin: 'tessera-org',
			name: 'notes',
			fullName: 'tessera-org/notes',
			sourceUrl: 'https://github.com/tessera-org/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'pending',
			nextSyncAt: new Date(),
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(gitHubCheckRunMappings)
		await db.delete(gitHubCommitStatusMappings)
		await db.delete(gitHubCheckSuiteMappings)
		await db.delete(checkObservations)
		await db.delete(checks)
		await db.delete(gitHubPullRequestEventMappings)
		await db.delete(gitHubPullRequestCommentMappings)
		await db.delete(gitHubPullRequestReviewerRequestMappings)
		await db.delete(gitHubPullRequestReviewMappings)
		await db.delete(gitHubPullRequestThreadMappings)
		await db.delete(gitHubPullRequestMappings)
		await db.delete(gitHubWebhookDeliveries)
		await db.delete(pullRequestEvents)
		await db.delete(pullRequestReviewerRequests)
		await db.delete(pullRequestComments)
		await db.delete(pullRequestThreads)
		await db.delete(pullRequestReviews)
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

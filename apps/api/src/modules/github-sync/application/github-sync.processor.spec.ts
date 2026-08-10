import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { PullRequestsService } from '@modules/pull-requests'
import { Logger } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubInstallationId,
	GitHubPullRequestMappingId,
	GitHubSyncAttemptId,
	GitHubWebhookDeliveryId,
	RepositoryExternalSourceId,
} from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { type Job, UnrecoverableError } from 'bullmq'
import { ExternalServiceError, ServiceUnavailableError } from '~/shared/errors'
import { GitHubAppAuthService } from '../infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '../infrastructure/github-sync.client'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_REPOSITORY_JOB,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '../infrastructure/github-sync.queue'
import {
	type GitHubSyncClaim,
	GitHubSyncRepository,
} from '../infrastructure/github-sync.repository'
import { GitHubSyncAuthorityError } from '../infrastructure/github-sync-authority'
import { GitHubSyncChecksRepository } from '../infrastructure/github-sync-checks.repository'
import { GitHubSyncConversationsRepository } from '../infrastructure/github-sync-conversations.repository'
import { GitHubSyncProcessor } from './github-sync.processor'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const attemptId = '00000000-0000-4000-8000-000000000009' as GitHubSyncAttemptId
/** The whole message, so prose around the code would fail the match. */
const BARE_FAILURE_CODE_MESSAGE = /^authentication_failed$/
const request = {
	repositoryId,
	authorityGeneration: 2,
	requestedSyncVersion: 5,
}
const claim: GitHubSyncClaim = {
	...request,
	externalSourceId:
		'00000000-0000-4000-8000-000000000003' as RepositoryExternalSourceId,
	leaseOwner: 'lease-owner',
	trigger: 'scheduled' as const,
	storagePath: '/var/lib/tessera/repositories/notes.git',
	externalRepositoryId: 456n,
	installationId:
		'00000000-0000-4000-8000-000000000004' as GitHubInstallationId,
	externalInstallationId: 123n,
	sourceUrl: 'https://github.com/tessera-org/notes',
	sourceDefaultBranch: 'main',
}
const reconciliation = {
	repository: {
		nodeId: 'repository-node',
		numericId: 456n,
		ownerLogin: 'tessera-org',
		name: 'notes',
		fullName: 'tessera-org/notes',
		htmlUrl: 'https://github.com/tessera-org/notes',
		cloneUrl: 'https://github.com/tessera-org/notes.git',
		defaultBranch: 'main',
	},
	pullRequests: [],
	pullRequestCursorAt: new Date('2026-07-29T01:00:00Z'),
}

describe(GitHubSyncProcessor.name, () => {
	let moduleRef: TestingModule
	let processor: GitHubSyncProcessor
	let authService: GitHubAppAuthService
	let client: GitHubSyncClient
	let repository: GitHubSyncRepository
	let queue: GitHubSyncQueue
	let gitStorageClient: GitStorageClient
	let pullRequestsService: PullRequestsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncProcessor,
				{
					provide: EnvService,
					useValue: {
						get: vi.fn((key: string) => {
							if (key === 'GITHUB_SYNC_LEASE_MINUTES') return 15
							if (key === 'GITHUB_MIRROR_SYNC_BATCH_SIZE') return 25
							return 60
						}),
					},
				},
				{
					provide: GitHubAppAuthService,
					useValue: {
						getInstallationToken: vi.fn(),
						evictInstallationToken: vi.fn(),
					},
				},
				{
					provide: GitHubSyncClient,
					useValue: {
						getChecksForRef: vi.fn(),
						getPullRequestConversation: vi.fn(),
						getRepositoryReconciliation: vi.fn(),
					},
				},
				{
					provide: GitHubSyncChecksRepository,
					useValue: { projectChecksForSha: vi.fn() },
				},
				{
					provide: GitHubSyncConversationsRepository,
					useValue: { projectPullRequestConversation: vi.fn() },
				},
				{
					provide: GitHubSyncRepository,
					useValue: {
						claimSync: vi.fn(),
						heartbeatSync: vi.fn(),
						upsertActors: vi.fn(),
						listPendingPullRequestEvents: vi.fn(),
						listPendingConversationDeliveries: vi.fn(async () => []),
						listConversationTargets: vi.fn(async () => []),
						listPendingCheckDeliveries: vi.fn(async () => []),
						listCheckTargets: vi.fn(async () => []),
						finalizeSync: vi.fn(),
						failSync: vi.fn(),
						terminalizeSync: vi.fn(),
						blockSync: vi.fn(),
						startSyncAttempt: vi.fn(),
						completeSyncAttempt: vi.fn(),
						recordInstallationRateLimit: vi.fn(),
						requestDueReconciliations: vi.fn(),
					},
				},
				{
					provide: GitHubSyncQueue,
					useValue: { enqueue: vi.fn() },
				},
				{
					provide: GitStorageClient,
					useValue: {
						compareRepositoryRefs: vi.fn(),
						importRepository: vi.fn(),
					},
				},
				{
					provide: PullRequestsService,
					useValue: { reconcileGitHubPullRequests: vi.fn() },
				},
			],
		}).compile()

		processor = moduleRef.get(GitHubSyncProcessor)
		authService = moduleRef.get(GitHubAppAuthService)
		client = moduleRef.get(GitHubSyncClient)
		repository = moduleRef.get(GitHubSyncRepository)
		queue = moduleRef.get(GitHubSyncQueue)
		gitStorageClient = moduleRef.get(GitStorageClient)
		pullRequestsService = moduleRef.get(PullRequestsService)

		vi.spyOn(repository, 'claimSync').mockResolvedValue(claim)
		vi.spyOn(repository, 'heartbeatSync').mockResolvedValue(true)
		vi.spyOn(repository, 'upsertActors').mockResolvedValue(new Map())
		vi.spyOn(repository, 'listPendingPullRequestEvents').mockResolvedValue([])
		vi.spyOn(repository, 'finalizeSync').mockResolvedValue(undefined)
		vi.spyOn(repository, 'startSyncAttempt').mockResolvedValue(attemptId)
		vi.spyOn(authService, 'getInstallationToken').mockResolvedValue({
			token: 'installation-token',
			expiresAt: new Date('2026-07-29T02:00:00Z'),
		})
		vi.spyOn(client, 'getRepositoryReconciliation').mockResolvedValue(
			reconciliation
		)
		vi.spyOn(gitStorageClient, 'importRepository').mockResolvedValue({
			storagePath: claim.storagePath,
			defaultBranch: 'main',
		})
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('claims, heartbeats, mirrors, reconciles pull requests, and finalizes', async () => {
		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.claimSync).toHaveBeenCalledWith(
			expect.objectContaining(request)
		)
		expect(authService.getInstallationToken).toHaveBeenCalledTimes(2)
		expect(client.getRepositoryReconciliation).toHaveBeenCalledWith({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
			updatedAfter: undefined,
		})
		expect(repository.heartbeatSync).toHaveBeenCalledTimes(2)
		expect(gitStorageClient.importRepository).toHaveBeenCalledWith({
			repositoryId,
			storagePath: claim.storagePath,
			sourceUrl: reconciliation.repository.cloneUrl,
			accessToken: 'installation-token',
			defaultBranchHint: 'main',
		})
		expect(
			pullRequestsService.reconcileGitHubPullRequests
		).toHaveBeenCalledWith({
			repositoryId,
			pullRequests: [],
			actorIds: new Map(),
			pendingEvents: [],
		})
		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId,
				authorityGeneration: 2,
				requestedSyncVersion: 5,
				leaseOwner: 'lease-owner',
				pullRequestSyncCursorAt: reconciliation.pullRequestCursorAt,
			})
		)
	})

	test('stops when a stale request cannot acquire the lease', async () => {
		vi.spyOn(repository, 'claimSync').mockResolvedValue(undefined)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(authService.getInstallationToken).not.toHaveBeenCalled()
		expect(client.getRepositoryReconciliation).not.toHaveBeenCalled()
	})

	test('dispatches all due repository requests', async () => {
		const secondRequest = { ...request, requestedSyncVersion: 6 }
		vi.spyOn(repository, 'requestDueReconciliations').mockResolvedValue([
			request,
			secondRequest,
		])

		await processor.process(
			createJob(GITHUB_SYNC_DISPATCHER_JOB, { type: 'dispatcher' })
		)

		expect(queue.enqueue).toHaveBeenCalledTimes(2)
		expect(queue.enqueue).toHaveBeenNthCalledWith(1, request)
		expect(queue.enqueue).toHaveBeenNthCalledWith(2, secondRequest)
	})

	test('records a safe retryable failure without letting an external error escape', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new Error('request failed with installation-token')
		)

		const promise = processor.process(
			createJob(GITHUB_SYNC_REPOSITORY_JOB, request)
		)

		// The message BullMQ keeps on a failed job, and everything the database
		// stores, has to be Tessera's own wording: an unclassified provider error
		// can carry a token or a header in its text.
		await expect(promise).rejects.toThrow('GitHub synchronization failed')
		await expect(promise).rejects.not.toThrow('installation-token')
		expect(repository.failSync).toHaveBeenCalledWith(
			expect.objectContaining({
				failureCode: 'reconciliation_failed',
				failureReason:
					'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.',
			})
		)
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				attemptId,
				status: 'retry_scheduled',
				failureClass: 'unknown',
				failureCode: 'reconciliation_failed',
			})
		)
	})

	test('opens an attempt for the run it claimed and closes it on success', async () => {
		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		// Provenance comes from the claimed version, not from the job that woke the
		// worker: the claim takes whatever version is newest by then.
		expect(repository.startSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId,
				authorityGeneration: 2,
				requestedSyncVersion: 5,
				installationId: claim.installationId,
				trigger: 'scheduled',
			})
		)
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				attemptId,
				status: 'succeeded',
				durationMs: expect.any(Number),
			})
		)
	})

	test('releases the lease when the attempt record itself cannot be opened', async () => {
		vi.spyOn(repository, 'startSyncAttempt').mockRejectedValue(
			new Error('attempts unavailable')
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('GitHub synchronization failed')
		// The lease is taken before the attempt row exists, so a failure here has to
		// go down the same path that clears it — otherwise the repository stays
		// leased until the lease expires and nothing reconciles it meanwhile.
		expect(repository.failSync).toHaveBeenCalledWith(
			expect.objectContaining({ leaseOwner: 'lease-owner' })
		)
		expect(repository.completeSyncAttempt).not.toHaveBeenCalled()
	})

	// Operators need to be able to query one shape for every outcome, and a run
	// that succeeded is as much an operational fact as one that failed.
	test('logs the same safe health fields for every settled run', async () => {
		const loggerLogSpy = vi
			.spyOn(Logger.prototype, 'log')
			.mockImplementation(() => undefined)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(loggerLogSpy).toHaveBeenCalledWith({
			event: 'github_sync_attempt',
			repositoryId,
			requestedSyncVersion: 5,
			trigger: 'scheduled',
			status: 'succeeded',
			failureClass: undefined,
			code: undefined,
			lastReconciliationDurationMs: expect.any(Number),
			retryAt: undefined,
		})
	})

	test('names only the stable code on the error that stops the job', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'authentication',
				failureCode: 'authentication_failed',
				scope: 'repository',
				statusCode: 401,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow(BARE_FAILURE_CODE_MESSAGE)
	})

	test('records no attempt for a stale request that never claimed the lease', async () => {
		vi.spyOn(repository, 'claimSync').mockResolvedValue(undefined)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.startSyncAttempt).not.toHaveBeenCalled()
	})

	test('records a run left incomplete by a contained outage as partial', async () => {
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue(['pruned-suite'])
		vi.spyOn(client, 'getChecksForRef').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'permanent_not_found',
				failureCode: 'resource_not_found',
				scope: 'suite',
				statusCode: 404,
			})
		)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		// The source row still says `succeeded`, so the attempt is the only place
		// this run's incompleteness survives for the health read model.
		expect(repository.failSync).not.toHaveBeenCalled()
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'partial' })
		)
	})

	test('defers a rate-limited installation instead of retrying the job', async () => {
		const resetAt = new Date('2026-08-11T13:00:00Z')
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'rate_limit',
				failureCode: 'rate_limited',
				scope: 'repository',
				statusCode: 429,
				retryAt: resetAt,
				rateLimitRemaining: 0,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toBeInstanceOf(UnrecoverableError)
		// The defer is persisted against the installation so every repository under
		// it is held back, and no worker sleeps waiting for the reset.
		expect(repository.recordInstallationRateLimit).toHaveBeenCalledWith(
			expect.objectContaining({
				installationId: claim.installationId,
				rateLimitedUntil: resetAt,
				remaining: 0,
			})
		)
		expect(repository.failSync).toHaveBeenCalledWith(
			expect.objectContaining({
				failureCode: 'rate_limited',
				nextSyncAt: resetAt,
			})
		)
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'retry_scheduled', retryAt: resetAt })
		)
		expect(repository.blockSync).not.toHaveBeenCalled()
	})

	test('records the budget a successful run observed', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockResolvedValue({
			...reconciliation,
			rateLimit: { remaining: 3200, resetAt: new Date('2026-08-11T13:00:00Z') },
		})

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.recordInstallationRateLimit).toHaveBeenCalledWith({
			installationId: claim.installationId,
			observedAt: expect.any(Date),
			remaining: 3200,
		})
	})

	test('blocks the repository and evicts the cached token when access is lost', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'authentication',
				failureCode: 'repository_unavailable',
				scope: 'repository',
				statusCode: 404,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toBeInstanceOf(UnrecoverableError)
		// A cached token stays valid for an hour, so the retry after a revocation
		// would present the same rejected credential.
		expect(authService.evictInstallationToken).toHaveBeenCalledWith(
			claim.externalInstallationId
		)
		expect(repository.blockSync).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId,
				authorityGeneration: 2,
				leaseOwner: 'lease-owner',
				failureCode: 'repository_unavailable',
			})
		)
		expect(repository.failSync).not.toHaveBeenCalled()
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'blocked' })
		)
	})

	test('terminalizes a payload GitHub would send again identically', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'validation',
				failureCode: 'provider_schema_mismatch',
				scope: 'repository',
				issuePaths: ['head.sha'],
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toBeInstanceOf(UnrecoverableError)
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'terminal_failed',
				failureClass: 'validation',
			})
		)
		// The version is settled rather than left outstanding, so the dispatcher
		// raises a new one next time instead of handing this one back as a second
		// attempt — which would contradict the outcome that said none follows.
		expect(repository.terminalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({
				requestedSyncVersion: 5,
				failureCode: 'provider_schema_mismatch',
				nextSyncAt: expect.any(Date),
			})
		)
		expect(repository.failSync).not.toHaveBeenCalled()
	})

	test('leaves a retryable version outstanding rather than settling it', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'transport',
				failureCode: 'upstream_unavailable',
				scope: 'repository',
				statusCode: 503,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow()
		expect(repository.failSync).toHaveBeenCalledOnce()
		expect(repository.terminalizeSync).not.toHaveBeenCalled()
	})

	test('keeps a transport failure retryable by the queue', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'transport',
				failureCode: 'upstream_unavailable',
				scope: 'repository',
				statusCode: 503,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.not.toBeInstanceOf(UnrecoverableError)
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'retry_scheduled' })
		)
	})

	test('projects incremental and forced webhook targets within the repair bound', async () => {
		const incrementalPullRequest = {
			...createPullRequestReconciliation(7),
		}
		vi.spyOn(client, 'getRepositoryReconciliation').mockResolvedValue({
			...reconciliation,
			pullRequests: [incrementalPullRequest],
		})
		vi.spyOn(repository, 'listPendingConversationDeliveries').mockResolvedValue(
			[
				{
					deliveryId:
						'00000000-0000-4000-8000-000000000070' as GitHubWebhookDeliveryId,
					eventName: 'issue_comment',
					action: 'deleted',
					subjectNumber: 8,
					receivedAt: new Date('2026-08-08T10:00:00Z'),
				},
			]
		)
		vi.spyOn(repository, 'listConversationTargets').mockResolvedValue([
			conversationTarget(7),
			conversationTarget(8),
		])
		vi.spyOn(client, 'getPullRequestConversation').mockResolvedValue(
			emptyConversation()
		)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.listConversationTargets).toHaveBeenCalledWith({
			deliveredNumbers: [8],
			limit: 50,
			repositoryId,
			updatedNumbers: [7],
		})
		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({ projectedNumbers: [7, 8] })
		)
		expect(client.getPullRequestConversation).toHaveBeenCalledTimes(2)
		expect(client.getPullRequestConversation).toHaveBeenNthCalledWith(1, {
			accessToken: 'installation-token',
			owner: 'tessera-org',
			repo: 'notes',
			pullRequestNumber: 7,
		})
		expect(client.getPullRequestConversation).toHaveBeenNthCalledWith(2, {
			accessToken: 'installation-token',
			owner: 'tessera-org',
			repo: 'notes',
			pullRequestNumber: 8,
		})
	})

	test('degrades a lost historical comparison to the current one whole', async () => {
		const conversationsRepository = moduleRef.get(
			GitHubSyncConversationsRepository
		)
		vi.spyOn(repository, 'listConversationTargets').mockResolvedValue([
			conversationTarget(7),
		])
		vi.spyOn(client, 'getPullRequestConversation').mockResolvedValue(
			outdatedLeftThreadConversation()
		)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockImplementation(
			({ headRef }) => {
				if (headRef === 'historical-head')
					return Promise.reject(
						new ExternalServiceError('git storage', {
							grpcCode: status.NOT_FOUND,
						})
					)

				return Promise.resolve({
					mergeBaseSha: 'current-merge-base',
				} as Awaited<ReturnType<typeof gitStorageClient.compareRepositoryRefs>>)
			}
		)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(
			conversationsRepository.projectPullRequestConversation
		).toHaveBeenCalledWith(
			expect.objectContaining({
				threads: [
					expect.objectContaining({
						providerOutdated: true,
						anchor: expect.objectContaining({
							anchorSha: 'current-merge-base',
							baseSha: 'base-sha',
							headSha: 'head-sha',
							line: 8,
							side: 'left',
							lineExcerpt: 'old value',
						}),
					}),
				],
			})
		)
	})

	test('fails the run when git storage cannot answer a comparison', async () => {
		const conversationsRepository = moduleRef.get(
			GitHubSyncConversationsRepository
		)
		vi.spyOn(repository, 'listConversationTargets').mockResolvedValue([
			conversationTarget(7),
		])
		vi.spyOn(client, 'getPullRequestConversation').mockResolvedValue(
			outdatedLeftThreadConversation()
		)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockRejectedValue(
			new ServiceUnavailableError('git storage', {
				grpcCode: status.UNAVAILABLE,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('git storage is unavailable')
		expect(
			conversationsRepository.projectPullRequestConversation
		).not.toHaveBeenCalled()
		expect(repository.failSync).toHaveBeenCalledOnce()
	})

	test('fails the run when git storage rejects a comparison request', async () => {
		const conversationsRepository = moduleRef.get(
			GitHubSyncConversationsRepository
		)
		vi.spyOn(repository, 'listConversationTargets').mockResolvedValue([
			conversationTarget(7),
		])
		vi.spyOn(client, 'getPullRequestConversation').mockResolvedValue(
			outdatedLeftThreadConversation()
		)
		vi.spyOn(gitStorageClient, 'compareRepositoryRefs').mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('git storage request failed')
		expect(
			conversationsRepository.projectPullRequestConversation
		).not.toHaveBeenCalled()
	})

	test('aborts before conversation fetch when authority heartbeat changes', async () => {
		vi.spyOn(repository, 'listConversationTargets').mockResolvedValue([
			conversationTarget(7),
		])
		vi.spyOn(repository, 'heartbeatSync')
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('GitHub synchronization authority changed')
		expect(client.getPullRequestConversation).not.toHaveBeenCalled()
		expect(repository.finalizeSync).not.toHaveBeenCalled()
	})

	test('deduplicates delivered and reconciled check SHAs and projects each once', async () => {
		const checksRepository = moduleRef.get(GitHubSyncChecksRepository)
		vi.spyOn(repository, 'listPendingCheckDeliveries').mockResolvedValue([
			{
				deliveryId:
					'00000000-0000-4000-8000-000000000090' as GitHubWebhookDeliveryId,
				eventName: 'status',
				targetSha: 'shared-head',
				targetResourceKind: 'commit_status',
				targetResourceNodeId: 'status-node',
				targetResourceNumericId: 90n,
				receivedAt: new Date('2026-08-08T10:00:00Z'),
			},
		])
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue([
			'shared-head',
			'cursor-head',
		])
		vi.spyOn(client, 'getChecksForRef').mockImplementation(({ ref }) =>
			Promise.resolve({ sha: ref, suites: [], runs: [], statuses: [] })
		)
		vi.spyOn(checksRepository, 'projectChecksForSha').mockResolvedValue({
			appendedObservations: 0,
			unrecognizedResults: [],
		})

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.listCheckTargets).toHaveBeenCalledWith({
			deliveredShas: ['shared-head'],
			limit: 50,
			repositoryId,
			updatedShas: [],
		})
		expect(client.getChecksForRef).toHaveBeenCalledTimes(2)
		expect(checksRepository.projectChecksForSha).toHaveBeenCalledTimes(2)
		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({
				projectedShas: ['shared-head', 'cursor-head'],
			})
		)
	})

	test('settles a delivery SHA a ref-level 404 proves unprojectable', async () => {
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue(['missing-head'])
		vi.spyOn(client, 'getChecksForRef').mockRejectedValue(
			new ExternalServiceError('GitHub', { scope: 'ref', statusCode: 404 })
		)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({ projectedShas: ['missing-head'] })
		)
	})

	test('leaves a SHA unsettled when only a resource under it went missing', async () => {
		const checksRepository = moduleRef.get(GitHubSyncChecksRepository)
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue(['pruned-suite'])
		vi.spyOn(client, 'getChecksForRef').mockRejectedValue(
			new ExternalServiceError('GitHub', { scope: 'suite', statusCode: 404 })
		)

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		// Nothing was projected and nothing was written off, so the deliveries
		// naming this commit stay pending for the next run.
		expect(checksRepository.projectChecksForSha).not.toHaveBeenCalled()
		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({ projectedShas: [] })
		)
	})

	test('contains a transient checks failure to the commit it happened on', async () => {
		const checksRepository = moduleRef.get(GitHubSyncChecksRepository)
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue([
			'failing-head',
			'healthy-head',
		])
		vi.spyOn(client, 'getChecksForRef').mockImplementation(({ ref }) =>
			ref === 'failing-head'
				? Promise.reject(
						new ExternalServiceError('GitHub', {
							scope: 'ref',
							statusCode: 500,
						})
					)
				: Promise.resolve({ sha: ref, suites: [], runs: [], statuses: [] })
		)
		vi.spyOn(checksRepository, 'projectChecksForSha').mockResolvedValue({
			appendedObservations: 0,
			unrecognizedResults: [],
		})

		await processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))

		// Checks run last, so failing the whole run here would throw away the pull
		// requests and conversations this run already reconciled. The commit GitHub
		// could not answer for is simply left unprojected: it is absent from
		// projectedShas, so its deliveries stay pending for the next run.
		expect(repository.finalizeSync).toHaveBeenCalledWith(
			expect.objectContaining({ projectedShas: ['healthy-head'] })
		)
		expect(repository.failSync).not.toHaveBeenCalled()
	})

	// Losing access is never one commit's problem: every remaining commit would
	// fail the same way, and containing it would finalize the run as successful
	// while the credential stays cached and the repository unblocked.
	test('escalates lost access found during the check stage', async () => {
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue([
			'first-head',
			'second-head',
		])
		vi.spyOn(client, 'getChecksForRef').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'authentication',
				failureCode: 'authorization_failed',
				scope: 'ref',
				statusCode: 403,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toBeInstanceOf(UnrecoverableError)
		expect(client.getChecksForRef).toHaveBeenCalledOnce()
		expect(repository.blockSync).toHaveBeenCalledOnce()
		expect(authService.evictInstallationToken).toHaveBeenCalledOnce()
		expect(repository.finalizeSync).not.toHaveBeenCalled()
	})

	test('escalates a rate limit found during the check stage', async () => {
		const resetAt = new Date('2026-08-11T13:00:00Z')
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue([
			'first-head',
			'second-head',
		])
		vi.spyOn(client, 'getChecksForRef').mockRejectedValue(
			new ExternalServiceError('GitHub', {
				failureClass: 'rate_limit',
				failureCode: 'rate_limited',
				scope: 'ref',
				statusCode: 429,
				retryAt: resetAt,
			})
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toBeInstanceOf(UnrecoverableError)
		// The limit belongs to the installation, so spending the rest of the run's
		// commits against it would only collect more refusals.
		expect(client.getChecksForRef).toHaveBeenCalledOnce()
		expect(repository.recordInstallationRateLimit).toHaveBeenCalledWith(
			expect.objectContaining({ rateLimitedUntil: resetAt })
		)
		expect(repository.finalizeSync).not.toHaveBeenCalled()
	})

	test('records a run whose authority moved on as interrupted, not failed', async () => {
		vi.spyOn(repository, 'heartbeatSync').mockResolvedValue(false)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('GitHub synchronization authority changed')
		// Another run owns the repository now. Recording a failure would overwrite
		// that run's state and blame this repository for a handover.
		expect(repository.completeSyncAttempt).toHaveBeenCalledWith(
			expect.objectContaining({
				status: 'interrupted',
				failureCode: 'authority_changed',
			})
		)
		expect(repository.failSync).not.toHaveBeenCalled()
		expect(repository.terminalizeSync).not.toHaveBeenCalled()
	})

	test('aborts the run when a check projection finds authority gone', async () => {
		const checksRepository = moduleRef.get(GitHubSyncChecksRepository)
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue([
			'head-sha',
			'later-head',
		])
		vi.spyOn(client, 'getChecksForRef').mockImplementation(({ ref }) =>
			Promise.resolve({ sha: ref, suites: [], runs: [], statuses: [] })
		)
		vi.spyOn(checksRepository, 'projectChecksForSha').mockRejectedValue(
			new GitHubSyncAuthorityError()
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('GitHub synchronization authority changed')
		// Containing per-commit failures must not downgrade a lost lease into a
		// skipped commit: another run owns the repository, so this one stops.
		expect(checksRepository.projectChecksForSha).toHaveBeenCalledTimes(1)
		expect(repository.finalizeSync).not.toHaveBeenCalled()
	})

	test('aborts before a check fetch when the authority heartbeat changes', async () => {
		vi.spyOn(repository, 'listCheckTargets').mockResolvedValue(['head-sha'])
		vi.spyOn(repository, 'heartbeatSync')
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('GitHub synchronization authority changed')
		expect(client.getChecksForRef).not.toHaveBeenCalled()
		expect(repository.finalizeSync).not.toHaveBeenCalled()
	})
})

function createJob(name: string, data: GitHubSyncJobData) {
	return { name, data } as Job<GitHubSyncJobData>
}

function outdatedLeftThreadConversation() {
	const comment = {
		nodeId: 'review-comment-node',
		numericId: 21n,
		author: {
			nodeId: 'author-node',
			numericId: 7n,
			login: 'marta',
			type: 'user' as const,
		},
		body: 'Inline',
		htmlUrl: 'https://github.com/tessera-org/notes/pull/7#discussion_r21',
		subjectType: 'line' as const,
		path: 'src/index.ts',
		side: 'left' as const,
		line: 8,
		originalLine: 8,
		originalCommitId: 'historical-head',
		diffHunk: '@@ -8 +8 @@\n-old value',
		createdAt: new Date('2026-08-08T10:00:00Z'),
		updatedAt: new Date('2026-08-08T10:00:00Z'),
	}

	return {
		...emptyConversation(),
		reviewComments: [comment],
		reviewThreads: [
			{
				nodeId: 'thread-node',
				resolved: false,
				outdated: true,
				subjectType: 'line' as const,
				side: 'left' as const,
				comments: [{ nodeId: comment.nodeId }],
			},
		],
	}
}

function emptyConversation() {
	return {
		issueComments: [],
		reviewComments: [],
		reviews: [],
		requestedReviewers: [],
		reviewThreads: [],
	}
}

function conversationTarget(externalNumber: number) {
	return {
		pullRequestMappingId:
			`00000000-0000-4000-8000-${externalNumber.toString().padStart(12, '0')}` as GitHubPullRequestMappingId,
		pullRequestId:
			`00000000-0000-4000-8001-${externalNumber.toString().padStart(12, '0')}` as PullRequestId,
		externalNodeId: `pull-request-${externalNumber}`,
		externalNumber,
		baseSha: 'base-sha',
		headSha: 'head-sha',
	}
}

function createPullRequestReconciliation(number: number) {
	return {
		nodeId: `pull-request-${number}`,
		numericId: BigInt(number),
		number,
		htmlUrl: `https://github.com/tessera-org/notes/pull/${number}`,
		title: `Pull request ${number}`,
		body: '',
		state: 'open' as const,
		draft: false,
		author: {
			nodeId: 'author-node',
			numericId: 7n,
			login: 'marta',
			type: 'user' as const,
		},
		sourceBranch: 'feature',
		targetBranch: 'main',
		headRepositoryNodeId: 'repository-node',
		baseRepositoryNodeId: 'repository-node',
		headSha: 'head-sha',
		baseSha: 'base-sha',
		createdAt: new Date('2026-08-08T10:00:00Z'),
		updatedAt: new Date('2026-08-08T10:00:00Z'),
	}
}

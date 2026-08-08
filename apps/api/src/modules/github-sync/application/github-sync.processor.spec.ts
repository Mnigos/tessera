import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { PullRequestsService } from '@modules/pull-requests'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubInstallationId,
	GitHubPullRequestMappingId,
	GitHubWebhookDeliveryId,
	RepositoryExternalSourceId,
} from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import type { Job } from 'bullmq'
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
import { GitHubSyncConversationsRepository } from '../infrastructure/github-sync-conversations.repository'
import { GitHubSyncProcessor } from './github-sync.processor'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
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
					useValue: { getInstallationToken: vi.fn() },
				},
				{
					provide: GitHubSyncClient,
					useValue: {
						getPullRequestConversation: vi.fn(),
						getRepositoryReconciliation: vi.fn(),
					},
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
						finalizeSync: vi.fn(),
						failSync: vi.fn(),
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

	test('records a safe retryable failure without persisting external errors', async () => {
		vi.spyOn(client, 'getRepositoryReconciliation').mockRejectedValue(
			new Error('request failed with installation-token')
		)

		await expect(
			processor.process(createJob(GITHUB_SYNC_REPOSITORY_JOB, request))
		).rejects.toThrow('request failed with installation-token')
		expect(repository.failSync).toHaveBeenCalledWith(
			expect.objectContaining({
				failureCode: 'reconciliation_failed',
				failureReason:
					'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.',
			})
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

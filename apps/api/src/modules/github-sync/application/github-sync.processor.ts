import { randomUUID } from 'node:crypto'
import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { PullRequestsService } from '@modules/pull-requests'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { Job } from 'bullmq'
import { GitHubAppAuthService } from '../infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '../infrastructure/github-sync.client'
import type { GitHubSyncActor } from '../infrastructure/github-sync.client.types'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_QUEUE_NAME,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '../infrastructure/github-sync.queue'
import {
	type GitHubSyncClaim,
	GitHubSyncRepository,
	type GitHubSyncRequest,
} from '../infrastructure/github-sync.repository'

const GITHUB_SYNC_FAILURE_RETRY_MINUTES = 15

@Injectable()
@Processor(GITHUB_SYNC_QUEUE_NAME, { concurrency: 2 })
export class GitHubSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubSyncProcessor.name)

	constructor(
		private readonly envService: EnvService,
		private readonly gitHubAppAuthService: GitHubAppAuthService,
		private readonly gitHubSyncClient: GitHubSyncClient,
		private readonly gitHubSyncRepository: GitHubSyncRepository,
		private readonly gitHubSyncQueue: GitHubSyncQueue,
		private readonly gitStorageClient: GitStorageClient,
		private readonly pullRequestsService: PullRequestsService
	) {
		super()
	}

	async process(job: Job<GitHubSyncJobData>): Promise<void> {
		if (job.name === GITHUB_SYNC_DISPATCHER_JOB) {
			await this.dispatchDueReconciliations()
			return
		}

		if (!isGitHubSyncRequest(job.data)) return

		const claim = await this.claim(job.data)
		if (!claim) return

		try {
			const installationToken =
				await this.gitHubAppAuthService.getInstallationToken(
					claim.externalInstallationId
				)
			const reconciliation =
				await this.gitHubSyncClient.getRepositoryReconciliation({
					accessToken: installationToken.token,
					externalRepositoryId: claim.externalRepositoryId,
				})
			await this.requireHeartbeat(claim)
			const mirrorToken = await this.gitHubAppAuthService.getInstallationToken(
				claim.externalInstallationId
			)
			const importResult = await this.gitStorageClient.importRepository({
				repositoryId: claim.repositoryId,
				storagePath: claim.storagePath,
				sourceUrl: reconciliation.repository.cloneUrl,
				accessToken: mirrorToken.token,
				defaultBranchHint: reconciliation.repository.defaultBranch,
			})
			await this.requireHeartbeat(claim)
			const actorIds = await this.gitHubSyncRepository.upsertActors(
				collectActors(reconciliation.pullRequests)
			)
			const pendingEvents =
				await this.gitHubSyncRepository.listPendingPullRequestEvents(claim)
			await this.pullRequestsService.reconcileGitHubPullRequests({
				repositoryId: claim.repositoryId,
				pullRequests: reconciliation.pullRequests,
				actorIds,
				pendingEvents,
			})
			const completedAt = new Date()
			const followUp = await this.gitHubSyncRepository.finalizeSync({
				repositoryId: claim.repositoryId,
				authorityGeneration: claim.authorityGeneration,
				requestedSyncVersion: claim.requestedSyncVersion,
				leaseOwner: claim.leaseOwner,
				storagePath: importResult.storagePath,
				defaultBranch:
					importResult.defaultBranch || reconciliation.repository.defaultBranch,
				externalRepositoryNodeId: reconciliation.repository.nodeId,
				ownerLogin: reconciliation.repository.ownerLogin,
				name: reconciliation.repository.name,
				fullName: reconciliation.repository.fullName,
				sourceUrl: reconciliation.repository.htmlUrl,
				sourceDefaultBranch: reconciliation.repository.defaultBranch,
				completedAt,
				nextSyncAt: addMinutes(
					completedAt,
					this.envService.get('GITHUB_MIRROR_SYNC_INTERVAL_MINUTES')
				),
			})

			if (followUp) await this.gitHubSyncQueue.enqueue(followUp)
		} catch (error) {
			const failedAt = new Date()
			await this.gitHubSyncRepository.failSync({
				repositoryId: claim.repositoryId,
				authorityGeneration: claim.authorityGeneration,
				leaseOwner: claim.leaseOwner,
				failedAt,
				failureCode: 'reconciliation_failed',
				failureReason:
					'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.',
				nextSyncAt: addMinutes(failedAt, GITHUB_SYNC_FAILURE_RETRY_MINUTES),
			})
			this.logger.error(
				'GitHub reconciliation failed',
				error instanceof Error ? error.stack : undefined
			)
			throw error
		}
	}

	private async claim(request: GitHubSyncRequest) {
		const leaseAcquiredAt = new Date()

		return await this.gitHubSyncRepository.claimSync({
			...request,
			leaseOwner: randomUUID(),
			leaseAcquiredAt,
			leaseExpiresAt: addMinutes(
				leaseAcquiredAt,
				this.envService.get('GITHUB_SYNC_LEASE_MINUTES')
			),
		})
	}

	private async requireHeartbeat(claim: GitHubSyncClaim): Promise<void> {
		const didHeartbeat = await this.gitHubSyncRepository.heartbeatSync({
			repositoryId: claim.repositoryId,
			authorityGeneration: claim.authorityGeneration,
			leaseOwner: claim.leaseOwner,
			leaseExpiresAt: addMinutes(
				new Date(),
				this.envService.get('GITHUB_SYNC_LEASE_MINUTES')
			),
		})

		if (!didHeartbeat)
			throw new Error('GitHub synchronization authority changed')
	}

	private async dispatchDueReconciliations(): Promise<void> {
		const requests = await this.gitHubSyncRepository.requestDueReconciliations({
			limit: this.envService.get('GITHUB_MIRROR_SYNC_BATCH_SIZE'),
			now: new Date(),
		})

		await Promise.all(
			requests.map(request => this.gitHubSyncQueue.enqueue(request))
		)
	}
}

function isGitHubSyncRequest(
	data: GitHubSyncJobData
): data is GitHubSyncRequest {
	return 'repositoryId' in data
}

function collectActors(
	pullRequests: { author: GitHubSyncActor; mergedBy?: GitHubSyncActor }[]
): GitHubSyncActor[] {
	const actors = new Map<string, GitHubSyncActor>()

	for (const pullRequest of pullRequests) {
		actors.set(pullRequest.author.nodeId, pullRequest.author)
		if (pullRequest.mergedBy)
			actors.set(pullRequest.mergedBy.nodeId, pullRequest.mergedBy)
	}

	return [...actors.values()]
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000)
}

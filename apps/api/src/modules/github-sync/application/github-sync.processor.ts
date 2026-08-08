import { randomUUID } from 'node:crypto'
import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { PullRequestsService } from '@modules/pull-requests'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type { RepositoryId } from '@repo/domain'
import type { Job } from 'bullmq'
import { DomainError } from '~/shared/errors'
import { toGitHubPullRequestAnchorCoordinates } from '../helpers/github-pull-request-anchor'
import {
	type GitHubGroupedReviewThread,
	groupGitHubReviewThreads,
} from '../helpers/github-pull-request-conversation'
import { GitHubAppAuthService } from '../infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '../infrastructure/github-sync.client'
import type {
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncRepository as GitHubSyncRepositoryDetails,
} from '../infrastructure/github-sync.client.types'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_QUEUE_NAME,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '../infrastructure/github-sync.queue'
import {
	type GitHubConversationTarget,
	type GitHubSyncClaim,
	GitHubSyncRepository,
	type GitHubSyncRequest,
} from '../infrastructure/github-sync.repository'
import {
	type GitHubConversationThreadProjection,
	GitHubSyncConversationsRepository,
} from '../infrastructure/github-sync-conversations.repository'

const GITHUB_SYNC_FAILURE_RETRY_MINUTES = 15
const MISSING_GIT_OBJECT_GRPC_CODES = new Set<number>([
	status.NOT_FOUND,
	status.INVALID_ARGUMENT,
])
/**
 * Conversations cost five listings and a GraphQL page each, so a run projects
 * at most this many pull requests. Named targets come first and the rotation
 * over the least recently projected mappings spends whatever budget is left,
 * which both repairs missed webhooks and backfills a freshly imported mirror.
 */
const GITHUB_CONVERSATION_PROJECTION_LIMIT = 50

@Injectable()
@Processor(GITHUB_SYNC_QUEUE_NAME, { concurrency: 2 })
export class GitHubSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubSyncProcessor.name)

	constructor(
		private readonly envService: EnvService,
		private readonly gitHubAppAuthService: GitHubAppAuthService,
		private readonly gitHubSyncClient: GitHubSyncClient,
		private readonly gitHubSyncConversationsRepository: GitHubSyncConversationsRepository,
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
					updatedAfter: claim.pullRequestSyncCursorAt,
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
			const projectedNumbers = await this.projectConversations({
				accessToken: mirrorToken.token,
				claim,
				pullRequestNumbers: reconciliation.pullRequests.map(
					pullRequest => pullRequest.number
				),
				repository: reconciliation.repository,
				storagePath: importResult.storagePath,
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
				pullRequestSyncCursorAt: reconciliation.pullRequestCursorAt,
				projectedNumbers,
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

	/**
	 * Reconciliation is the authority for conversations too: each selected pull
	 * request is re-read whole and projected in one transaction, so a delete or a
	 * resolution whose webhook never arrived still lands. The numbers it returns
	 * are the ones whose pending deliveries this run may consume.
	 */
	private async projectConversations({
		accessToken,
		claim,
		pullRequestNumbers,
		repository,
		storagePath,
	}: {
		accessToken: string
		claim: GitHubSyncClaim
		pullRequestNumbers: number[]
		repository: GitHubSyncRepositoryDetails
		storagePath: string
	}): Promise<number[]> {
		const deliveries =
			await this.gitHubSyncRepository.listPendingConversationDeliveries(claim)
		const targets = await this.gitHubSyncRepository.listConversationTargets({
			deliveredNumbers: [
				...new Set(deliveries.map(delivery => delivery.subjectNumber)),
			],
			limit: GITHUB_CONVERSATION_PROJECTION_LIMIT,
			repositoryId: claim.repositoryId,
			updatedNumbers: [...new Set(pullRequestNumbers)],
		})
		const projectedNumbers: number[] = []

		for (const target of targets) {
			await this.requireHeartbeat(claim)

			const conversation =
				await this.gitHubSyncClient.getPullRequestConversation({
					accessToken,
					owner: repository.ownerLogin,
					pullRequestNumber: target.externalNumber,
					repo: repository.name,
				})
			const actorIds = await this.gitHubSyncRepository.upsertActors(
				collectConversationActors(conversation)
			)
			const { orphanedComments, threads } =
				groupGitHubReviewThreads(conversation)

			await this.gitHubSyncConversationsRepository.projectPullRequestConversation(
				{
					actorIds,
					authorityGeneration: claim.authorityGeneration,
					conversation,
					deliveries: deliveries.filter(
						delivery => delivery.subjectNumber === target.externalNumber
					),
					leaseOwner: claim.leaseOwner,
					orphanedComments,
					repositoryId: claim.repositoryId,
					syncedAt: new Date(),
					syncVersion: claim.requestedSyncVersion,
					target,
					threads: await this.resolveThreadAnchors({
						claim,
						storagePath,
						target,
						threads,
					}),
				}
			)
			projectedNumbers.push(target.externalNumber)
		}

		return projectedNumbers
	}

	private async resolveThreadAnchors({
		claim,
		storagePath,
		target,
		threads,
	}: {
		claim: GitHubSyncClaim
		storagePath: string
		target: GitHubConversationTarget
		threads: GitHubGroupedReviewThread[]
	}): Promise<GitHubConversationThreadProjection[]> {
		const mergeBases = new Map<string, string | undefined>()
		const projections: GitHubConversationThreadProjection[] = []

		for (const thread of threads) {
			const coordinates = toGitHubPullRequestAnchorCoordinates(thread.root, {
				currentHeadSha: target.headSha,
				providerOutdated: thread.providerOutdated,
			})

			if (!coordinates) {
				projections.push({ thread, providerOutdated: thread.providerOutdated })
				continue
			}

			const { headSha, outdated, ...anchorLine } = coordinates
			let providerOutdated = outdated || thread.providerOutdated
			let anchorHeadSha = headSha
			let anchorSha: string | undefined = headSha

			// A left anchor points at the merge base, which only Git can tell us. A
			// comparison the mirror no longer holds degrades to the current one whole:
			// a merge base from one comparison and a head from another describe a diff
			// that never existed.
			if (anchorLine.side === 'left') {
				anchorSha = await this.findMergeBase(mergeBases, {
					baseRef: target.baseSha,
					headRef: anchorHeadSha,
					repositoryId: claim.repositoryId,
					storagePath,
				})

				if (!anchorSha && anchorHeadSha !== target.headSha) {
					anchorSha = await this.findMergeBase(mergeBases, {
						baseRef: target.baseSha,
						headRef: target.headSha,
						repositoryId: claim.repositoryId,
						storagePath,
					})

					if (anchorSha) {
						anchorHeadSha = target.headSha
						providerOutdated = true
					}
				}
			}

			if (!anchorSha) {
				projections.push({ thread, providerOutdated })
				continue
			}

			projections.push({
				thread,
				providerOutdated,
				anchor: {
					...anchorLine,
					anchorSha,
					baseSha: target.baseSha,
					headSha: anchorHeadSha,
				},
			})
		}

		return projections
	}

	private async findMergeBase(
		mergeBases: Map<string, string | undefined>,
		{
			baseRef,
			headRef,
			repositoryId,
			storagePath,
		}: {
			baseRef: string
			headRef: string
			repositoryId: RepositoryId
			storagePath: string
		}
	): Promise<string | undefined> {
		const key = `${baseRef}...${headRef}`

		if (mergeBases.has(key)) return mergeBases.get(key)

		try {
			const comparison = await this.gitStorageClient.compareRepositoryRefs({
				baseRef,
				headRef,
				repositoryId,
				storagePath,
			})

			mergeBases.set(key, comparison.mergeBaseSha || undefined)
		} catch (error) {
			// A commit the mirror never received is an expected gap. Storage being
			// unreachable is not: degrading there would rewrite anchors that are
			// still correct as stale, so the run fails and retries instead.
			if (!isMissingGitObjectError(error)) throw error

			this.logger.debug(`GitHub anchor comparison ${key} is unavailable`)
			mergeBases.set(key, undefined)
		}

		return mergeBases.get(key)
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

/** A ref the mirror does not hold, as opposed to storage that cannot answer. */
function isMissingGitObjectError(error: unknown): boolean {
	if (!(error instanceof DomainError)) return false

	return MISSING_GIT_OBJECT_GRPC_CODES.has(Number(error.context?.grpcCode))
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

/**
 * Every GitHub identity a conversation names, including the ones Tessera has no
 * account for: an unmapped actor still has to render.
 */
function collectConversationActors({
	issueComments,
	requestedReviewers,
	reviewComments,
	reviews,
	reviewThreads,
}: GitHubPullRequestConversation): GitHubSyncActor[] {
	const actors = new Map<string, GitHubSyncActor>()

	for (const comment of issueComments)
		actors.set(comment.author.nodeId, comment.author)
	for (const comment of reviewComments)
		actors.set(comment.author.nodeId, comment.author)
	for (const review of reviews)
		actors.set(review.reviewer.nodeId, review.reviewer)
	for (const requested of requestedReviewers)
		if (requested.kind === 'user')
			actors.set(requested.actor.nodeId, requested.actor)
	for (const thread of reviewThreads)
		if (thread.resolvedBy)
			actors.set(thread.resolvedBy.nodeId, thread.resolvedBy)

	return [...actors.values()]
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000)
}

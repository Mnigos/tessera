import { randomUUID } from 'node:crypto'
import { EnvService } from '@config/env'
import { GitStorageClient } from '@config/git-storage'
import { status } from '@grpc/grpc-js'
import { PullRequestsService } from '@modules/pull-requests'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import type {
	GitHubSyncAttemptId,
	GitHubSyncAttemptStatus,
	GitHubSyncFailureClass,
	RepositorySyncProgress,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import { type Job, UnrecoverableError } from 'bullmq'
import { DomainError } from '~/shared/errors'
import { GitHubSyncExternalServiceError } from '../domain/github-sync.errors'
import {
	type GitHubSyncFailure,
	readGitHubSyncFailure,
	toGitHubSyncFailureReason,
} from '../domain/github-sync-failure'
import { toGitHubPullRequestAnchorCoordinates } from '../helpers/github-pull-request-anchor'
import {
	type GitHubGroupedReviewThread,
	groupGitHubReviewThreads,
} from '../helpers/github-pull-request-conversation'
import { GitHubAppAuthService } from '../infrastructure/github-app-auth.service'
import { GitHubSyncClient } from '../infrastructure/github-sync.client'
import type {
	GitHubChecksRequestScope,
	GitHubChecksSnapshot,
	GitHubPullRequestConversation,
	GitHubSyncActor,
	GitHubSyncRateLimit,
	GitHubSyncRepository as GitHubSyncRepositoryDetails,
} from '../infrastructure/github-sync.client.types'
import {
	GITHUB_SYNC_DISPATCHER_JOB,
	GITHUB_SYNC_QUEUE_NAME,
	type GitHubSyncJobData,
	GitHubSyncQueue,
} from '../infrastructure/github-sync.queue'
import {
	GITHUB_SYNC_INTERRUPTED_CODES,
	type GitHubConversationTarget,
	type GitHubSyncClaim,
	GitHubSyncRepository,
	type GitHubSyncRequest,
} from '../infrastructure/github-sync.repository'
import { GitHubSyncAuthorityError } from '../infrastructure/github-sync-authority'
import { GitHubSyncChecksRepository } from '../infrastructure/github-sync-checks.repository'
import {
	type GitHubConversationThreadProjection,
	GitHubSyncConversationsRepository,
} from '../infrastructure/github-sync-conversations.repository'

const GITHUB_SYNC_FAILURE_RETRY_MINUTES = 15
/**
 * Conversations cost five listings and a GraphQL page each, so a run projects
 * at most this many pull requests. Named targets come first and the rotation
 * over the least recently projected mappings spends whatever budget is left,
 * which both repairs missed webhooks and backfills a freshly imported mirror.
 */
const GITHUB_CONVERSATION_PROJECTION_LIMIT = 50
/**
 * Checks cost a suite listing, a run listing per suite and a status listing per
 * commit, so a run reconciles at most this many commits. Commits a delivery
 * named come first and the rotation over the least recently reconciled open
 * pull request heads spends the rest.
 */
const GITHUB_CHECK_PROJECTION_LIMIT = 50
/** The only scope whose 404 speaks for the commit rather than a resource under it. */
const GITHUB_CHECKS_REF_SCOPE: GitHubChecksRequestScope = 'ref'

/**
 * What one commit's reconciliation produced: results to project, settled
 * evidence that the commit is gone, or a read too incomplete to conclude either.
 */
type GitHubChecksSnapshotOutcome =
	| { outcome: 'projected'; snapshot: GitHubChecksSnapshot }
	| { outcome: 'unprojectable' | 'incomplete'; snapshot?: undefined }

@Injectable()
@Processor(GITHUB_SYNC_QUEUE_NAME, { concurrency: 2 })
export class GitHubSyncProcessor extends WorkerHost {
	private readonly logger = new Logger(GitHubSyncProcessor.name)

	constructor(
		private readonly envService: EnvService,
		private readonly gitHubAppAuthService: GitHubAppAuthService,
		private readonly gitHubSyncChecksRepository: GitHubSyncChecksRepository,
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

		const startedAt = new Date()
		// Opening the attempt happens inside the try, because the lease is already
		// held: anything that throws between claiming and the failure path would
		// leave the repository leased until the lease expired on its own.
		let attemptId: GitHubSyncAttemptId | undefined

		try {
			attemptId = await this.gitHubSyncRepository.startSyncAttempt({
				repositoryId: claim.repositoryId,
				authorityGeneration: claim.authorityGeneration,
				requestedSyncVersion: claim.requestedSyncVersion,
				installationId: claim.installationId,
				// Provenance comes from the claimed version, not from this job: the
				// claim takes whatever version is newest, which may be one a later
				// delivery or a replay asked for after this job was enqueued.
				trigger: claim.trigger,
				replayDeliveryId: claim.replayDeliveryId,
				jobId: job.id,
				startedAt,
			})

			await this.writeProgress(claim, { stage: 'listing' })
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
			await this.writeProgress(claim, { stage: 'repository' })
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
			await this.writeProgress(claim, {
				stage: 'pull_requests',
				total: reconciliation.pullRequests.length,
			})
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
			await this.observeRateLimit(claim, reconciliation.rateLimit)
			const { isComplete, projectedShas } = await this.projectChecks({
				accessToken: mirrorToken.token,
				claim,
				headShas: reconciliation.pullRequests.map(
					pullRequest => pullRequest.headSha
				),
				repository: reconciliation.repository,
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
				projectedShas,
				completedAt,
				nextSyncAt: addMinutes(
					completedAt,
					this.envService.get('GITHUB_MIRROR_SYNC_INTERVAL_MINUTES')
				),
			})

			if (followUp) await this.gitHubSyncQueue.enqueue(followUp)

			// A run that finalized without reconciling everything it selected is not
			// a failure — its deliveries stay pending and the next run asks again —
			// but the source row records only `succeeded`, so the attempt is the one
			// place that difference survives.
			await this.settleAttempt(claim, attemptId, {
				status: isComplete ? 'succeeded' : 'partial',
				startedAt,
				finishedAt: completedAt,
			})
		} catch (error) {
			await this.failRun({ attemptId, claim, error, startedAt })
		} finally {
			// However the run ended, nothing is in progress anymore.
			await this.writeProgress(claim, null)
		}
	}

	/** Progress is display data; a run never fails because a write of it did. */
	private async writeProgress(
		claim: GitHubSyncClaim,
		progress: Omit<RepositorySyncProgress, 'updatedAt'> | null
	): Promise<void> {
		try {
			await this.gitHubSyncRepository.writeSyncProgress(
				claim.repositoryId,
				progress
			)
		} catch (error) {
			this.logger.warn(
				`Sync progress for repository ${claim.repositoryId} could not be written`,
				error
			)
		}
	}

	/**
	 * Ends a failed run the way its failure deserves.
	 *
	 * The taxonomy decides three things at once: what the source row says, when
	 * the work is due again, and whether BullMQ should try this same job again.
	 * Retrying a rejected credential or a payload GitHub will send again
	 * identically only spends requests, so those outcomes stop the job and leave
	 * recovery to the schedule or to GitHub telling us access is back.
	 */
	private async failRun({
		attemptId,
		claim,
		error,
		startedAt,
	}: {
		attemptId?: GitHubSyncAttemptId
		claim: GitHubSyncClaim
		error: unknown
		startedAt: Date
	}): Promise<never> {
		const finishedAt = new Date()

		// Losing authority is not this run's failure: another run owns the
		// repository now, and every write this one could make is fenced out
		// anyway. Recording a source failure would overwrite that run's state, and
		// counting it as a failed operation would blame the repository for what is
		// really a handover.
		if (error instanceof GitHubSyncAuthorityError) {
			await this.settleAttempt(claim, attemptId, {
				status: 'interrupted',
				failureCode: GITHUB_SYNC_INTERRUPTED_CODES.authorityChanged,
				startedAt,
				finishedAt,
			})

			throw error
		}

		const failure = readGitHubSyncFailure(error)
		const failureReason = toGitHubSyncFailureReason(failure.failureClass)

		if (failure.failureClass === 'authentication') {
			this.gitHubAppAuthService.evictInstallationToken(
				claim.externalInstallationId
			)
			await this.gitHubSyncRepository.blockSync({
				repositoryId: claim.repositoryId,
				authorityGeneration: claim.authorityGeneration,
				leaseOwner: claim.leaseOwner,
				failedAt: finishedAt,
				failureCode: failure.failureCode,
				failureReason,
			})
			await this.settleAttempt(claim, attemptId, {
				status: 'blocked',
				failureClass: failure.failureClass,
				failureCode: failure.failureCode,
				startedAt,
				finishedAt,
			})

			throw new UnrecoverableError(failure.failureCode)
		}

		const nextSyncAt = this.resolveNextSyncAt(failure, finishedAt)

		if (failure.failureClass === 'rate_limit')
			await this.gitHubSyncRepository.recordInstallationRateLimit({
				installationId: claim.installationId,
				observedAt: finishedAt,
				remaining: failure.rateLimitRemaining,
				rateLimitedUntil: nextSyncAt,
			})

		const settlement = {
			repositoryId: claim.repositoryId,
			authorityGeneration: claim.authorityGeneration,
			leaseOwner: claim.leaseOwner,
			failedAt: finishedAt,
			failureCode: failure.failureCode,
			failureReason,
			nextSyncAt,
		}

		// A version no repeat of the same request can satisfy is settled rather
		// than left outstanding, so the dispatcher raises a new version next time
		// instead of handing this one back as another attempt.
		if (schedulesAnotherAttempt(failure))
			await this.gitHubSyncRepository.failSync(settlement)
		else
			await this.gitHubSyncRepository.terminalizeSync({
				...settlement,
				requestedSyncVersion: claim.requestedSyncVersion,
			})

		await this.settleAttempt(claim, attemptId, {
			status: schedulesAnotherAttempt(failure)
				? 'retry_scheduled'
				: 'terminal_failed',
			failureClass: failure.failureClass,
			failureCode: failure.failureCode,
			retryAt: nextSyncAt,
			startedAt,
			finishedAt,
		})

		if (!allowsJobRetry(failure))
			throw new UnrecoverableError(failure.failureCode)

		// A domain error carries a message Tessera wrote; anything else carries
		// whatever the provider put in it, and BullMQ keeps failed jobs now.
		if (error instanceof DomainError) throw error

		throw new GitHubSyncExternalServiceError({
			failureClass: failure.failureClass,
			failureCode: failure.failureCode,
		})
	}

	/**
	 * Records what a GitHub response said about this installation's budget.
	 *
	 * A response that spends the last permitted request is the cheapest warning
	 * there is: without a defer recorded here, the next repository under the same
	 * installation spends one more and gets the refusal instead.
	 */
	private async observeRateLimit(
		claim: GitHubSyncClaim,
		rateLimit?: GitHubSyncRateLimit
	): Promise<void> {
		if (!rateLimit) return

		await this.gitHubSyncRepository.recordInstallationRateLimit({
			installationId: claim.installationId,
			observedAt: new Date(),
			remaining: rateLimit.remaining,
			rateLimitedUntil:
				rateLimit.remaining === 0 ? rateLimit.resetAt : undefined,
		})
	}

	/**
	 * When the work is due again. A rate limit answers this itself; everything
	 * else waits the fixed retry interval, including the outcomes no further job
	 * attempt will follow — a repository is never abandoned, only slowed down.
	 */
	private resolveNextSyncAt(
		{ failureClass, retryAt }: GitHubSyncFailure,
		failedAt: Date
	): Date {
		const scheduledAt = addMinutes(failedAt, GITHUB_SYNC_FAILURE_RETRY_MINUTES)

		if (failureClass !== 'rate_limit' || !retryAt) return scheduledAt

		return retryAt > failedAt ? retryAt : scheduledAt
	}

	/**
	 * Records how a run ended, once, in both places that need it: the durable
	 * attempt row and one structured log line carrying the same safe fields the
	 * health read model exposes. Every outcome goes through here, successes
	 * included — an operator reading logs should not have to infer a healthy run
	 * from the absence of a failure.
	 */
	private async settleAttempt(
		claim: GitHubSyncClaim,
		attemptId: GitHubSyncAttemptId | undefined,
		{
			failureClass,
			failureCode,
			finishedAt,
			retryAt,
			startedAt,
			status,
		}: {
			status: Exclude<GitHubSyncAttemptStatus, 'running'>
			failureClass?: GitHubSyncFailureClass
			failureCode?: string
			finishedAt: Date
			retryAt?: Date
			startedAt: Date
		}
	): Promise<void> {
		const durationMs = finishedAt.getTime() - startedAt.getTime()

		this.logger.log({
			event: 'github_sync_attempt',
			repositoryId: claim.repositoryId,
			requestedSyncVersion: claim.requestedSyncVersion,
			trigger: claim.trigger,
			status,
			failureClass,
			code: failureCode,
			lastReconciliationDurationMs: durationMs,
			retryAt: retryAt?.toISOString(),
		})

		if (!attemptId) return

		await this.gitHubSyncRepository.completeSyncAttempt({
			attemptId,
			status,
			failureClass,
			failureCode,
			finishedAt,
			durationMs,
			retryAt,
		})
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

		if (!didHeartbeat) throw new GitHubSyncAuthorityError()
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
			await this.writeProgress(claim, {
				stage: 'conversations',
				current: projectedNumbers.length,
				total: targets.length,
			})

			const conversation =
				await this.gitHubSyncClient.getPullRequestConversation({
					accessToken,
					owner: repository.ownerLogin,
					pullRequestNumber: target.externalNumber,
					repo: repository.name,
				})
			await this.observeRateLimit(claim, conversation.rateLimit)

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

	/**
	 * Checks belong to a commit rather than a pull request, so this stage picks
	 * commits: the ones a delivery named, the heads the reconciliation page just
	 * reported, and a rotation over the open pull request heads reconciled least
	 * recently. Each is re-read whole, because a rerun GitHub never delivered is
	 * only discoverable by asking.
	 *
	 * The commits it returns are the ones whose pending check deliveries this run
	 * may consume — including a commit GitHub no longer has, which is settled
	 * evidence rather than a result. A commit it could conclude nothing about
	 * makes the run incomplete, which the attempt records as `partial`.
	 */
	private async projectChecks({
		accessToken,
		claim,
		headShas,
		repository,
	}: {
		accessToken: string
		claim: GitHubSyncClaim
		headShas: string[]
		repository: GitHubSyncRepositoryDetails
	}): Promise<{ isComplete: boolean; projectedShas: string[] }> {
		const deliveries =
			await this.gitHubSyncRepository.listPendingCheckDeliveries(claim)
		const targets = await this.gitHubSyncRepository.listCheckTargets({
			deliveredShas: [
				...new Set(deliveries.map(delivery => delivery.targetSha)),
			],
			limit: GITHUB_CHECK_PROJECTION_LIMIT,
			repositoryId: claim.repositoryId,
			updatedShas: [...new Set(headShas)],
		})
		const projectedShas: string[] = []
		let isComplete = true
		let reconciledCount = 0

		for (const sha of targets) {
			await this.requireHeartbeat(claim)
			await this.writeProgress(claim, {
				stage: 'checks',
				current: reconciledCount,
				total: targets.length,
			})
			reconciledCount += 1

			try {
				const { outcome, snapshot } = await this.findChecksSnapshot({
					accessToken,
					repository,
					sha,
				})

				await this.observeRateLimit(claim, snapshot?.rateLimit)

				// An incomplete snapshot proves nothing either way, so the commit is
				// neither projected nor written off: its deliveries stay pending and the
				// next run asks again.
				if (outcome === 'incomplete') {
					isComplete = false
					continue
				}

				if (!snapshot) {
					projectedShas.push(sha)
					continue
				}

				const { unrecognizedResults } =
					await this.gitHubSyncChecksRepository.projectChecksForSha({
						actorIds: await this.gitHubSyncRepository.upsertActors(
							collectCheckActors(snapshot)
						),
						authorityGeneration: claim.authorityGeneration,
						deliveries: deliveries.filter(
							delivery => delivery.targetSha === sha
						),
						leaseOwner: claim.leaseOwner,
						repositoryId: claim.repositoryId,
						sha,
						snapshot,
						syncedAt: new Date(),
						syncVersion: claim.requestedSyncVersion,
					})

				for (const result of unrecognizedResults)
					this.logger.warn(
						`GitHub reported ${result.kind} ${result.context} on ${sha} as ${result.unrecognized}, which Tessera reads as a failure`
					)

				projectedShas.push(sha)
			} catch (error) {
				// Checks are the last stage of a run that has already reconciled pull
				// requests and finalized conversations. One commit GitHub could not
				// answer for must not discard all of that, so the commit is left
				// unprojected — its deliveries stay pending and the next run asks
				// again — while the run finalizes what did succeed. Losing authority
				// is not one commit's problem and still aborts everything.
				if (error instanceof GitHubSyncAuthorityError) throw error

				const failure = readGitHubSyncFailure(error)

				// Losing access or hitting a limit is never one commit's problem: it
				// is true of the whole installation, and every remaining commit would
				// fail the same way. Containing it here would finalize the run as
				// successful while the credential stays uncached-out and the
				// installation undeferred.
				if (
					failure.failureClass === 'authentication' ||
					failure.failureClass === 'rate_limit'
				)
					throw error

				isComplete = false

				this.logger.warn(
					`GitHub checks reconciliation for ${sha} failed as ${failure.failureClass}/${failure.failureCode}`
				)
			}
		}

		return { isComplete, projectedShas }
	}

	/**
	 * The snapshot for one commit, or the reason there is none.
	 *
	 * Only the listings addressed by the commit itself can say a commit is gone. A
	 * 404 from one of them is a permanent gap: a force push or a deleted fork
	 * leaves deliveries naming a commit nobody can reconcile, and retrying them
	 * forever would stall every later delivery behind them. A 404 from a suite's
	 * own page is GitHub pruning a child resource mid-read, which leaves this
	 * snapshot short of runs the commit still has — projecting it would record an
	 * absence that never happened.
	 */
	private async findChecksSnapshot({
		accessToken,
		repository,
		sha,
	}: {
		accessToken: string
		repository: GitHubSyncRepositoryDetails
		sha: string
	}): Promise<GitHubChecksSnapshotOutcome> {
		try {
			return {
				outcome: 'projected',
				snapshot: await this.gitHubSyncClient.getChecksForRef({
					accessToken,
					owner: repository.ownerLogin,
					ref: sha,
					repo: repository.name,
				}),
			}
		} catch (error) {
			const failure = readGitHubSyncFailure(error)

			// Only an absence is settled evidence. Everything else — a refusal, a
			// limit, an outage — is contained by the caller for this commit alone.
			if (failure.failureClass !== 'permanent_not_found') throw error

			if (failure.scope !== GITHUB_CHECKS_REF_SCOPE) {
				this.logger.debug(
					`GitHub stopped reporting a check suite of ${sha} mid-read`
				)

				return { outcome: 'incomplete' }
			}

			this.logger.debug(`GitHub no longer reports checks for ${sha}`)

			return { outcome: 'unprojectable' }
		}
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

/**
 * A ref the mirror does not hold, as opposed to storage that cannot answer or a
 * request storage refused: git storage reports an unresolvable revision as
 * NOT_FOUND and keeps INVALID_ARGUMENT for inputs it considers malformed.
 */
function isMissingGitObjectError(error: unknown): boolean {
	if (!(error instanceof DomainError)) return false

	return Number(error.context?.grpcCode) === status.NOT_FOUND
}

/**
 * Whether this exact requested version will be attempted again. A limit and an
 * outage both leave the version requested, so the dispatcher or the queue comes
 * back to it; a payload mismatch and an absence abandon it, and whatever the
 * schedule does next is a new operation rather than another try at this one.
 */
function schedulesAnotherAttempt({ failureClass }: GitHubSyncFailure): boolean {
	return (
		failureClass === 'transport' ||
		failureClass === 'unknown' ||
		failureClass === 'rate_limit'
	)
}

/**
 * Whether repeating the request right now could succeed. A limit is excluded
 * deliberately: retrying inside it would spend this repository's five job
 * attempts against a GitHub that is still refusing, and the deferral already
 * brings the work back once the limit resets.
 */
function allowsJobRetry({ failureClass }: GitHubSyncFailure): boolean {
	return failureClass === 'transport' || failureClass === 'unknown'
}

/**
 * A commit status is posted by an account, which is a real identity worth
 * resolving. A check run is reported by a GitHub App, which is never a person
 * and travels as a snapshot on the mapping instead.
 */
function collectCheckActors({
	statuses,
}: GitHubChecksSnapshot): GitHubSyncActor[] {
	const actors = new Map<string, GitHubSyncActor>()

	for (const commitStatus of statuses)
		if (commitStatus.creator)
			actors.set(commitStatus.creator.nodeId, commitStatus.creator)

	return [...actors.values()]
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

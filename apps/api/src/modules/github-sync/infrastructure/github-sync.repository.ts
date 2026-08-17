import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type {
	DrizzleTransaction,
	GitHubActorId,
	GitHubInstallationId,
	GitHubPullRequestMappingId,
	GitHubSyncAttemptId,
	GitHubSyncAttemptStatus,
	GitHubSyncAttemptTrigger,
	GitHubSyncFailureClass,
	GitHubWebhookDeliveryId,
	RepositoryExternalSourceId,
} from '@repo/db'
import {
	and,
	asc,
	eq,
	gitHubInstallations,
	gitHubPullRequestMappings,
	gitHubSyncAttempts,
	gitHubWebhookDeliveries,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	notExists,
	or,
	repositories,
	repositoryExternalSources,
	sql,
} from '@repo/db'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import type { SQL } from 'drizzle-orm'
import {
	GITHUB_CHECK_WEBHOOK_EVENTS,
	GITHUB_CONVERSATION_WEBHOOK_EVENTS,
	type GitHubWebhookTargetResourceKind,
	isSupportedGitHubWebhookEvent,
} from '../domain/github-webhook.schema'
import { upsertGitHubActor } from './github-actor.upsert'
import type { GitHubSyncActor } from './github-sync.client.types'

interface GitHubInstallationReferenceInput {
	externalInstallationId: bigint
	suspendedAt?: Date | null
}

interface GitHubInstallationDetailsInput
	extends GitHubInstallationReferenceInput {
	accountNodeId: string
	accountLogin: string
	targetType: 'user' | 'organization'
}

export type GitHubInstallationInput =
	| GitHubInstallationReferenceInput
	| GitHubInstallationDetailsInput

interface ResolvedGitHubInstallation {
	id: GitHubInstallationId
	suspendedAt?: Date
}

interface GitHubInstallationRepositoryInput {
	id: number
	node_id: string
}

interface RecordWebhookDeliveryParams {
	deliveryId: GitHubWebhookDeliveryId
	eventName: string
	action?: string
	installation?: GitHubInstallationInput
	externalRepositoryNodeId?: string
	externalRepositoryNumericId?: bigint
	subjectNodeId?: string
	subjectNumber?: number
	issueNumber?: number
	targetResourceKind?: GitHubWebhookTargetResourceKind
	targetResourceNodeId?: string
	targetResourceNumericId?: bigint
	targetSha?: string
	targetContext?: string
	targetTeamNodeId?: string
	targetTeamSlug?: string
	sender?: GitHubSyncActor
	targetActor?: GitHubSyncActor
	labelNodeId?: string
	labelName?: string
	addedInstallationRepositories?: GitHubInstallationRepositoryInput[]
	removedInstallationRepositories?: GitHubInstallationRepositoryInput[]
}

/**
 * A wakeup, and nothing more. It names the repository and the version that was
 * outstanding when it was raised; it deliberately carries no provenance,
 * because the claim takes whatever version is newest by then and the answer to
 * "what asked for this" belongs to that version rather than to this wakeup.
 */
export interface GitHubSyncRequest {
	repositoryId: RepositoryId
	authorityGeneration: number
	requestedSyncVersion: number
}

export interface RecordWebhookDeliveryResult {
	accepted: boolean
	duplicate: boolean
	syncRequests: GitHubSyncRequest[]
}

/**
 * Why an attempt reached no outcome. Neither is a failure of the repository:
 * one is another run taking over, the other is a worker that died.
 */
export const GITHUB_SYNC_INTERRUPTED_CODES = {
	authorityChanged: 'authority_changed',
	leaseReclaimed: 'lease_reclaimed',
} as const

export interface GitHubSyncClaim extends GitHubSyncRequest {
	externalSourceId: RepositoryExternalSourceId
	/** What asked for the version this run actually claimed. */
	trigger: GitHubSyncAttemptTrigger
	replayDeliveryId?: GitHubWebhookDeliveryId
	leaseOwner: string
	storagePath: string
	externalRepositoryId: bigint
	installationId: GitHubInstallationId
	externalInstallationId: bigint
	sourceUrl: string
	sourceDefaultBranch: string
	pullRequestSyncCursorAt?: Date
}

export interface GitHubPendingPullRequestEvent {
	deliveryId: GitHubWebhookDeliveryId
	subjectNumber: number
	action: string
	actorId?: GitHubActorId
	receivedAt: Date
}

export interface GitHubPendingConversationDelivery {
	deliveryId: GitHubWebhookDeliveryId
	eventName: string
	action?: string
	subjectNumber: number
	targetResourceKind?: GitHubWebhookTargetResourceKind
	targetResourceNodeId?: string
	targetResourceNumericId?: bigint
	targetActorId?: GitHubActorId
	targetTeamNodeId?: string
	actorId?: GitHubActorId
	receivedAt: Date
}

export interface GitHubPendingCheckDelivery {
	deliveryId: GitHubWebhookDeliveryId
	eventName: string
	action?: string
	targetSha: string
	targetResourceKind?: GitHubWebhookTargetResourceKind
	targetResourceNodeId?: string
	targetResourceNumericId?: bigint
	targetContext?: string
	actorId?: GitHubActorId
	receivedAt: Date
}

export interface GitHubConversationTarget {
	pullRequestMappingId: GitHubPullRequestMappingId
	pullRequestId: PullRequestId
	externalNodeId: string
	externalNumber: number
	baseSha: string
	headSha: string
}

interface ClaimSyncParams extends GitHubSyncRequest {
	leaseOwner: string
	leaseAcquiredAt: Date
	leaseExpiresAt: Date
}

interface FinalizeSyncParams
	extends Pick<
		GitHubSyncClaim,
		| 'repositoryId'
		| 'authorityGeneration'
		| 'requestedSyncVersion'
		| 'leaseOwner'
	> {
	storagePath: string
	defaultBranch: string
	externalRepositoryNodeId: string
	ownerLogin: string
	name: string
	fullName: string
	sourceUrl: string
	sourceDefaultBranch: string
	pullRequestSyncCursorAt: Date
	/** Pull request numbers whose conversation this run actually projected. */
	projectedNumbers: number[]
	/**
	 * Commit SHAs this run projected checks for, or proved it never could. A
	 * check delivery is consumed on that evidence alone.
	 */
	projectedShas: string[]
	completedAt: Date
	nextSyncAt: Date
}

interface FailSyncParams
	extends Pick<
		GitHubSyncClaim,
		'repositoryId' | 'authorityGeneration' | 'leaseOwner'
	> {
	failedAt: Date
	failureCode: string
	failureReason: string
	nextSyncAt: Date
}

interface TerminalizeSyncParams extends FailSyncParams {
	requestedSyncVersion: number
}

interface BlockSyncParams
	extends Pick<
		GitHubSyncClaim,
		'repositoryId' | 'authorityGeneration' | 'leaseOwner'
	> {
	failedAt: Date
	failureCode: string
	failureReason: string
}

interface StartSyncAttemptParams
	extends Pick<
		GitHubSyncClaim,
		| 'repositoryId'
		| 'authorityGeneration'
		| 'requestedSyncVersion'
		| 'installationId'
	> {
	trigger: GitHubSyncAttemptTrigger
	jobId?: string
	replayDeliveryId?: GitHubWebhookDeliveryId
	startedAt: Date
}

interface CompleteSyncAttemptParams {
	attemptId: GitHubSyncAttemptId
	status: Exclude<GitHubSyncAttemptStatus, 'running'>
	failureClass?: GitHubSyncFailureClass
	failureCode?: string
	finishedAt: Date
	durationMs: number
	retryAt?: Date
}

interface RecordInstallationRateLimitParams {
	installationId: GitHubInstallationId
	observedAt: Date
	remaining?: number
	rateLimitedUntil?: Date
}

interface RecordFailedWebhookDeliveryParams {
	deliveryId: GitHubWebhookDeliveryId
	eventName: string
	failedAt: Date
	failureCode: string
	failureReason: string
}

/**
 * Excludes the sources whose installation GitHub is still refusing. Rate limits
 * are counted per installation, so deferring one leaves every other
 * installation reconciling at full speed — which a queue-wide pause or a worker
 * that slept until the reset would not.
 *
 * The installation is reached through a subquery rather than a join so that
 * `for update skip locked` keeps locking sources alone: locking the
 * installation row would serialize every repository that shares it.
 */
function isNotRateLimitedInstallation(
	db: DrizzleTransaction,
	now: Date
): SQL | undefined {
	return notExists(
		db
			.select({ id: gitHubInstallations.id })
			.from(gitHubInstallations)
			.where(
				and(
					eq(gitHubInstallations.id, repositoryExternalSources.installationId),
					gt(gitHubInstallations.rateLimitedUntil, now)
				)
			)
	)
}

const CONVERSATION_TARGET_COLUMNS = {
	pullRequestMappingId: gitHubPullRequestMappings.id,
	pullRequestId: gitHubPullRequestMappings.pullRequestId,
	externalNodeId: gitHubPullRequestMappings.externalNodeId,
	externalNumber: gitHubPullRequestMappings.externalNumber,
	baseSha: gitHubPullRequestMappings.baseSha,
	headSha: gitHubPullRequestMappings.headSha,
}

@Injectable()
export class GitHubSyncRepository {
	constructor(private readonly db: Database) {}

	async upsertActors(
		actors: GitHubSyncActor[]
	): Promise<Map<string, GitHubActorId>> {
		return await this.db.transaction(async transaction => {
			const actorIds = new Map<string, GitHubActorId>()

			for (const actor of actors)
				actorIds.set(actor.nodeId, await upsertGitHubActor(transaction, actor))

			return actorIds
		})
	}

	async listPendingPullRequestEvents({
		repositoryId,
		requestedSyncVersion,
	}: Pick<GitHubSyncClaim, 'repositoryId' | 'requestedSyncVersion'>): Promise<
		GitHubPendingPullRequestEvent[]
	> {
		const rows = await this.db
			.select({
				deliveryId: gitHubWebhookDeliveries.id,
				subjectNumber: gitHubWebhookDeliveries.subjectNumber,
				action: gitHubWebhookDeliveries.action,
				actorId: gitHubWebhookDeliveries.senderActorId,
				receivedAt: gitHubWebhookDeliveries.receivedAt,
			})
			.from(gitHubWebhookDeliveries)
			.where(
				and(
					eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
					eq(gitHubWebhookDeliveries.eventName, 'pull_request'),
					eq(gitHubWebhookDeliveries.status, 'received'),
					isNotNull(gitHubWebhookDeliveries.subjectNumber),
					isNotNull(gitHubWebhookDeliveries.action),
					lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion)
				)
			)

		return rows.flatMap(row =>
			row.subjectNumber && row.action
				? [
						{
							deliveryId: row.deliveryId,
							subjectNumber: row.subjectNumber,
							action: row.action,
							actorId: row.actorId ?? undefined,
							receivedAt: row.receivedAt,
						},
					]
				: []
		)
	}

	/**
	 * Conversation deliveries whose pull request must be reconciled even when the
	 * incremental cursor page does not return it, such as a deleted comment.
	 */
	async listPendingConversationDeliveries({
		repositoryId,
		requestedSyncVersion,
	}: Pick<GitHubSyncClaim, 'repositoryId' | 'requestedSyncVersion'>): Promise<
		GitHubPendingConversationDelivery[]
	> {
		const rows = await this.db
			.select({
				deliveryId: gitHubWebhookDeliveries.id,
				eventName: gitHubWebhookDeliveries.eventName,
				action: gitHubWebhookDeliveries.action,
				subjectNumber: gitHubWebhookDeliveries.subjectNumber,
				targetResourceKind: gitHubWebhookDeliveries.targetResourceKind,
				targetResourceNodeId: gitHubWebhookDeliveries.targetResourceNodeId,
				targetResourceNumericId:
					gitHubWebhookDeliveries.targetResourceNumericId,
				targetActorId: gitHubWebhookDeliveries.targetActorId,
				targetTeamNodeId: gitHubWebhookDeliveries.targetTeamNodeId,
				actorId: gitHubWebhookDeliveries.senderActorId,
				receivedAt: gitHubWebhookDeliveries.receivedAt,
			})
			.from(gitHubWebhookDeliveries)
			.where(
				and(
					eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
					inArray(gitHubWebhookDeliveries.eventName, [
						...GITHUB_CONVERSATION_WEBHOOK_EVENTS,
					]),
					eq(gitHubWebhookDeliveries.status, 'received'),
					isNotNull(gitHubWebhookDeliveries.subjectNumber),
					lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion)
				)
			)

		return rows.flatMap(row =>
			row.subjectNumber
				? [
						{
							deliveryId: row.deliveryId,
							eventName: row.eventName,
							action: row.action ?? undefined,
							subjectNumber: row.subjectNumber,
							targetResourceKind: row.targetResourceKind ?? undefined,
							targetResourceNodeId: row.targetResourceNodeId ?? undefined,
							targetResourceNumericId: row.targetResourceNumericId ?? undefined,
							targetActorId: row.targetActorId ?? undefined,
							targetTeamNodeId: row.targetTeamNodeId ?? undefined,
							actorId: row.actorId ?? undefined,
							receivedAt: row.receivedAt,
						},
					]
				: []
		)
	}

	/**
	 * Check deliveries whose commit this run must reconcile. A check names a SHA
	 * that may sit outside the pull request cursor, belong to no pull request
	 * Tessera tracks, or already be a superseded head, so the delivery is the only
	 * thing that can force it into the run.
	 */
	async listPendingCheckDeliveries({
		repositoryId,
		requestedSyncVersion,
	}: Pick<GitHubSyncClaim, 'repositoryId' | 'requestedSyncVersion'>): Promise<
		GitHubPendingCheckDelivery[]
	> {
		const rows = await this.db
			.select({
				deliveryId: gitHubWebhookDeliveries.id,
				eventName: gitHubWebhookDeliveries.eventName,
				action: gitHubWebhookDeliveries.action,
				targetSha: gitHubWebhookDeliveries.targetSha,
				targetResourceKind: gitHubWebhookDeliveries.targetResourceKind,
				targetResourceNodeId: gitHubWebhookDeliveries.targetResourceNodeId,
				targetResourceNumericId:
					gitHubWebhookDeliveries.targetResourceNumericId,
				targetContext: gitHubWebhookDeliveries.targetContext,
				actorId: gitHubWebhookDeliveries.senderActorId,
				receivedAt: gitHubWebhookDeliveries.receivedAt,
			})
			.from(gitHubWebhookDeliveries)
			.where(
				and(
					eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
					inArray(gitHubWebhookDeliveries.eventName, [
						...GITHUB_CHECK_WEBHOOK_EVENTS,
					]),
					eq(gitHubWebhookDeliveries.status, 'received'),
					isNotNull(gitHubWebhookDeliveries.targetSha),
					lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion)
				)
			)

		return rows.flatMap(row =>
			row.targetSha
				? [
						{
							deliveryId: row.deliveryId,
							eventName: row.eventName,
							action: row.action ?? undefined,
							targetSha: row.targetSha,
							targetResourceKind: row.targetResourceKind ?? undefined,
							targetResourceNodeId: row.targetResourceNodeId ?? undefined,
							targetResourceNumericId: row.targetResourceNumericId ?? undefined,
							targetContext: row.targetContext ?? undefined,
							actorId: row.actorId ?? undefined,
							receivedAt: row.receivedAt,
						},
					]
				: []
		)
	}

	/**
	 * Pull requests whose conversation this run projects, in the order their
	 * evidence would be lost. A delivery is the only record of what it carried, so
	 * its pull request is projected before the incremental page and before the
	 * rotation over the least recently projected mappings, which repairs missed
	 * webhooks and backfills a fresh mirror with whatever budget is left.
	 */
	async listConversationTargets({
		deliveredNumbers,
		limit,
		repositoryId,
		updatedNumbers,
	}: {
		deliveredNumbers: number[]
		limit: number
		repositoryId: RepositoryId
		updatedNumbers: number[]
	}): Promise<GitHubConversationTarget[]> {
		if (limit <= 0) return []

		const selected: GitHubConversationTarget[] = []
		const selectedIds = new Set<GitHubPullRequestMappingId>()

		for (const externalNumbers of [
			deliveredNumbers,
			updatedNumbers,
			undefined,
		]) {
			if (selected.length >= limit) break
			if (externalNumbers && externalNumbers.length === 0) continue

			const targets = await this.findConversationTargets({
				externalNumbers,
				limit: limit + selected.length,
				repositoryId,
			})

			for (const target of targets) {
				if (selected.length >= limit) break
				if (selectedIds.has(target.pullRequestMappingId)) continue

				selectedIds.add(target.pullRequestMappingId)
				selected.push(target)
			}
		}

		return selected
	}

	/**
	 * Commits whose checks this run projects, in the order their evidence would be
	 * lost. A delivery names a commit that may sit outside every cursor, so it is
	 * reconciled first; heads the reconciliation page just reported come next; the
	 * rotation over the least recently reconciled open pull request heads spends
	 * whatever budget is left, which repairs missed webhooks and backfills a fresh
	 * mirror. A commit several pull requests share is projected once.
	 */
	async listCheckTargets({
		deliveredShas,
		limit,
		repositoryId,
		updatedShas,
	}: {
		deliveredShas: string[]
		limit: number
		repositoryId: RepositoryId
		updatedShas: string[]
	}): Promise<string[]> {
		if (limit <= 0) return []

		const selected: string[] = []
		const selectedShas = new Set<string>()

		for (const sha of [...deliveredShas, ...updatedShas]) {
			if (selected.length >= limit) break
			if (selectedShas.has(sha)) continue

			selectedShas.add(sha)
			selected.push(sha)
		}

		if (selected.length >= limit) return selected

		const rotated = await this.db
			.select({ headSha: gitHubPullRequestMappings.headSha })
			.from(gitHubPullRequestMappings)
			.where(
				and(
					eq(gitHubPullRequestMappings.repositoryId, repositoryId),
					isNull(gitHubPullRequestMappings.providerClosedAt)
				)
			)
			.orderBy(
				sql`${gitHubPullRequestMappings.checksSyncedAt} asc nulls first`,
				asc(gitHubPullRequestMappings.externalNumber)
			)
			.limit(limit + selected.length)

		for (const { headSha } of rotated) {
			if (selected.length >= limit) break
			if (selectedShas.has(headSha)) continue

			selectedShas.add(headSha)
			selected.push(headSha)
		}

		return selected
	}

	private async findConversationTargets({
		externalNumbers,
		limit,
		repositoryId,
	}: {
		externalNumbers?: number[]
		limit: number
		repositoryId: RepositoryId
	}): Promise<GitHubConversationTarget[]> {
		return await this.db
			.select(CONVERSATION_TARGET_COLUMNS)
			.from(gitHubPullRequestMappings)
			.where(
				and(
					eq(gitHubPullRequestMappings.repositoryId, repositoryId),
					externalNumbers
						? inArray(gitHubPullRequestMappings.externalNumber, externalNumbers)
						: undefined
				)
			)
			.orderBy(
				sql`${gitHubPullRequestMappings.conversationSyncedAt} asc nulls first`,
				asc(gitHubPullRequestMappings.externalNumber)
			)
			.limit(limit)
	}

	async recordWebhookDelivery(
		params: RecordWebhookDeliveryParams
	): Promise<RecordWebhookDeliveryResult> {
		return await this.db.transaction(transaction =>
			this.recordWebhookDeliveryInTransaction(transaction, params)
		)
	}

	private async recordWebhookDeliveryInTransaction(
		transaction: DrizzleTransaction,
		params: RecordWebhookDeliveryParams
	): Promise<RecordWebhookDeliveryResult> {
		const didInsert = await this.persistWebhookDelivery(transaction, params)

		if (!didInsert)
			return {
				accepted: true,
				duplicate: true,
				syncRequests: await this.findOutstandingDeliverySyncRequest(
					transaction,
					params.deliveryId
				),
			}

		const installation = params.installation
			? await this.resolveInstallation(transaction, params.installation)
			: undefined
		const installationId = installation?.id

		if (installationId)
			await transaction
				.update(gitHubWebhookDeliveries)
				.set({ installationId })
				.where(eq(gitHubWebhookDeliveries.id, params.deliveryId))

		const installationSyncRequests = installationId
			? await this.applyInstallationChanges(transaction, {
					action: params.action,
					addedRepositories: params.addedInstallationRepositories,
					installationId,
					removedRepositories: params.removedInstallationRepositories,
				})
			: []

		if (params.eventName === 'installation' && params.action === 'deleted') {
			await this.completeUnscopedDelivery(transaction, params)
			return {
				accepted: true,
				duplicate: false,
				syncRequests: installationSyncRequests,
			}
		}

		if (
			!(params.externalRepositoryNumericId || params.externalRepositoryNodeId)
		) {
			await this.completeUnscopedDelivery(transaction, params)
			return {
				accepted: true,
				duplicate: false,
				syncRequests: installationSyncRequests,
			}
		}

		if (!isSupportedGitHubWebhookEvent(params)) {
			await this.ignoreWebhookDelivery(transaction, params.deliveryId)
			return {
				accepted: true,
				duplicate: false,
				syncRequests: installationSyncRequests,
			}
		}

		const externalSource = await this.findExternalSourceForDelivery(
			transaction,
			params
		)
		if (!externalSource) {
			await this.ignoreWebhookDelivery(transaction, params.deliveryId)
			return {
				accepted: true,
				duplicate: false,
				syncRequests: installationSyncRequests,
			}
		}

		await transaction
			.update(repositoryExternalSources)
			.set({
				installationId,
				externalRepositoryNodeId: params.externalRepositoryNodeId,
			})
			.where(
				eq(repositoryExternalSources.repositoryId, externalSource.repositoryId)
			)

		if (
			externalSource.mirrorMode !== 'github_to_tessera' ||
			!installationId ||
			installation?.suspendedAt
		) {
			await this.ignoreUnsyncableDelivery(transaction, {
				deliveryId: params.deliveryId,
				isSuspended: Boolean(installation?.suspendedAt),
				repositoryId: externalSource.repositoryId,
			})
			return {
				accepted: true,
				duplicate: false,
				syncRequests: installationSyncRequests,
			}
		}

		const syncRequest = await this.requestWebhookSync(transaction, {
			...externalSource,
			deliveryId: params.deliveryId,
		})

		return {
			accepted: true,
			duplicate: false,
			syncRequests: syncRequest
				? [...installationSyncRequests, syncRequest]
				: installationSyncRequests,
		}
	}

	private async persistWebhookDelivery(
		transaction: DrizzleTransaction,
		{
			installationId,
			sender,
			targetActor,
			...params
		}: RecordWebhookDeliveryParams & {
			installationId?: GitHubInstallationId
		}
	): Promise<boolean> {
		const [senderActorId, targetActorId] = await Promise.all([
			sender ? upsertGitHubActor(transaction, sender) : undefined,
			targetActor ? upsertGitHubActor(transaction, targetActor) : undefined,
		])
		const [insertedDelivery] = await transaction
			.insert(gitHubWebhookDeliveries)
			.values({
				id: params.deliveryId,
				installationId,
				eventName: params.eventName,
				action: params.action,
				externalRepositoryNodeId: params.externalRepositoryNodeId,
				externalRepositoryNumericId: params.externalRepositoryNumericId,
				subjectNodeId: params.subjectNodeId,
				subjectNumber: params.subjectNumber,
				issueNumber: params.issueNumber,
				targetResourceKind: params.targetResourceKind,
				targetResourceNodeId: params.targetResourceNodeId,
				targetResourceNumericId: params.targetResourceNumericId,
				targetSha: params.targetSha,
				targetContext: params.targetContext,
				targetTeamNodeId: params.targetTeamNodeId,
				targetTeamSlug: params.targetTeamSlug,
				senderActorId,
				targetActorId,
				labelNodeId: params.labelNodeId,
				labelName: params.labelName,
			})
			.onConflictDoNothing()
			.returning({ id: gitHubWebhookDeliveries.id })

		return Boolean(insertedDelivery)
	}

	private async completeUnscopedDelivery(
		transaction: DrizzleTransaction,
		{ deliveryId, eventName }: RecordWebhookDeliveryParams
	): Promise<void> {
		const isInstallationEvent =
			eventName === 'installation' || eventName === 'installation_repositories'

		await transaction
			.update(gitHubWebhookDeliveries)
			.set({
				status: isInstallationEvent ? 'processed' : 'ignored',
				processedAt: new Date(),
			})
			.where(eq(gitHubWebhookDeliveries.id, deliveryId))
	}

	private async findExternalSourceForDelivery(
		transaction: DrizzleTransaction,
		{
			externalRepositoryNodeId,
			externalRepositoryNumericId,
		}: RecordWebhookDeliveryParams
	) {
		const conditions: SQL[] = []
		if (externalRepositoryNumericId)
			conditions.push(
				eq(
					repositoryExternalSources.externalRepositoryId,
					externalRepositoryNumericId
				)
			)
		if (externalRepositoryNodeId)
			conditions.push(
				eq(
					repositoryExternalSources.externalRepositoryNodeId,
					externalRepositoryNodeId
				)
			)

		const [externalSource] = await transaction
			.select({
				repositoryId: repositoryExternalSources.repositoryId,
				mirrorMode: repositoryExternalSources.mirrorMode,
				authorityGeneration: repositoryExternalSources.authorityGeneration,
			})
			.from(repositoryExternalSources)
			.where(
				and(eq(repositoryExternalSources.provider, 'github'), or(...conditions))
			)
			.limit(1)
			.for('update')

		return externalSource
	}

	private async ignoreWebhookDelivery(
		transaction: DrizzleTransaction,
		deliveryId: GitHubWebhookDeliveryId
	): Promise<void> {
		await transaction
			.update(gitHubWebhookDeliveries)
			.set({ status: 'ignored', processedAt: new Date() })
			.where(eq(gitHubWebhookDeliveries.id, deliveryId))
	}

	private async findOutstandingDeliverySyncRequest(
		transaction: DrizzleTransaction,
		deliveryId: GitHubWebhookDeliveryId
	): Promise<GitHubSyncRequest[]> {
		const [request] = await transaction
			.select({
				repositoryId: repositoryExternalSources.repositoryId,
				authorityGeneration: repositoryExternalSources.authorityGeneration,
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})
			.from(gitHubWebhookDeliveries)
			.innerJoin(
				repositoryExternalSources,
				eq(
					repositoryExternalSources.repositoryId,
					gitHubWebhookDeliveries.repositoryId
				)
			)
			.where(
				and(
					eq(gitHubWebhookDeliveries.id, deliveryId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
					isNotNull(repositoryExternalSources.installationId),
					lt(
						repositoryExternalSources.completedSyncVersion,
						repositoryExternalSources.requestedSyncVersion
					)
				)
			)
			.limit(1)

		return request ? [request] : []
	}

	private async ignoreUnsyncableDelivery(
		transaction: DrizzleTransaction,
		{
			deliveryId,
			isSuspended,
			repositoryId,
		}: {
			deliveryId: GitHubWebhookDeliveryId
			isSuspended: boolean
			repositoryId: RepositoryId
		}
	): Promise<void> {
		if (isSuspended)
			await transaction
				.update(repositoryExternalSources)
				.set({
					syncStatus: 'blocked',
					syncFailureCode: 'installation_suspended',
					syncFailureReason:
						'The Tessera GitHub App installation is suspended. Restore the installation to resume synchronization.',
					nextSyncAt: null,
				})
				.where(eq(repositoryExternalSources.repositoryId, repositoryId))

		await transaction
			.update(gitHubWebhookDeliveries)
			.set({
				repositoryId,
				status: 'ignored',
				processedAt: new Date(),
			})
			.where(eq(gitHubWebhookDeliveries.id, deliveryId))
	}

	private async requestWebhookSync(
		transaction: DrizzleTransaction,
		{
			authorityGeneration,
			deliveryId,
			repositoryId,
		}: {
			authorityGeneration: number
			deliveryId: GitHubWebhookDeliveryId
			repositoryId: RepositoryId
		}
	): Promise<GitHubSyncRequest | undefined> {
		const [requestedSource] = await transaction
			.update(repositoryExternalSources)
			.set({
				requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
				requestedSyncTrigger: 'webhook',
				requestedReplayDeliveryId: null,
				syncStatus: 'pending',
				syncFailureCode: null,
				syncFailureReason: null,
				nextSyncAt: new Date(),
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(
						repositoryExternalSources.authorityGeneration,
						authorityGeneration
					),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
			.returning({
				repositoryId: repositoryExternalSources.repositoryId,
				authorityGeneration: repositoryExternalSources.authorityGeneration,
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})

		if (!requestedSource) return undefined

		await transaction
			.update(gitHubWebhookDeliveries)
			.set({
				repositoryId: requestedSource.repositoryId,
				syncVersion: requestedSource.requestedSyncVersion,
			})
			.where(eq(gitHubWebhookDeliveries.id, deliveryId))

		return requestedSource
	}

	async claimSync({
		authorityGeneration,
		leaseAcquiredAt,
		leaseExpiresAt,
		leaseOwner,
		repositoryId,
		requestedSyncVersion,
	}: ClaimSyncParams): Promise<GitHubSyncClaim | undefined> {
		return await this.db.transaction(async transaction => {
			const [source] = await transaction
				.update(repositoryExternalSources)
				.set({
					syncStatus: 'running',
					lastSyncStartedAt: leaseAcquiredAt,
					syncLeaseOwner: leaseOwner,
					syncLeaseAcquiredAt: leaseAcquiredAt,
					syncLeaseExpiresAt: leaseExpiresAt,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(
							repositoryExternalSources.authorityGeneration,
							authorityGeneration
						),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
						isNotNull(repositoryExternalSources.installationId),
						gte(
							repositoryExternalSources.requestedSyncVersion,
							requestedSyncVersion
						),
						lt(
							repositoryExternalSources.completedSyncVersion,
							requestedSyncVersion
						),
						or(
							isNull(repositoryExternalSources.syncLeaseOwner),
							lte(repositoryExternalSources.syncLeaseExpiresAt, leaseAcquiredAt)
						),
						// A job already in the queue is held back the same way the
						// dispatcher holds one back, so a limit noticed after enqueue still
						// stops the request from being spent. The version stays requested
						// and `nextSyncAt` stays due, so the dispatcher picks the work up
						// again on the first pass after the limit resets.
						isNotRateLimitedInstallation(transaction, leaseAcquiredAt)
					)
				)
				.returning({
					id: repositoryExternalSources.id,
					repositoryId: repositoryExternalSources.repositoryId,
					installationId: repositoryExternalSources.installationId,
					externalRepositoryId: repositoryExternalSources.externalRepositoryId,
					sourceUrl: repositoryExternalSources.sourceUrl,
					sourceDefaultBranch: repositoryExternalSources.sourceDefaultBranch,
					authorityGeneration: repositoryExternalSources.authorityGeneration,
					requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
					trigger: repositoryExternalSources.requestedSyncTrigger,
					replayDeliveryId: repositoryExternalSources.requestedReplayDeliveryId,
					pullRequestSyncCursorAt:
						repositoryExternalSources.pullRequestSyncCursorAt,
				})

			if (!source?.installationId) return undefined

			const [context] = await transaction
				.select({
					storagePath: repositories.storagePath,
					externalInstallationId: gitHubInstallations.externalInstallationId,
					suspendedAt: gitHubInstallations.suspendedAt,
				})
				.from(repositories)
				.innerJoin(
					gitHubInstallations,
					eq(gitHubInstallations.id, source.installationId)
				)
				.where(eq(repositories.id, source.repositoryId))
				.limit(1)

			if (!(context?.storagePath && !context.suspendedAt)) {
				await transaction
					.update(repositoryExternalSources)
					.set({
						syncStatus: 'blocked',
						syncFailureCode: context?.suspendedAt
							? 'installation_suspended'
							: 'missing_storage',
						syncFailureReason: context?.suspendedAt
							? 'The Tessera GitHub App installation is suspended.'
							: 'Repository mirror storage is unavailable.',
						nextSyncAt: null,
						syncLeaseOwner: null,
						syncLeaseAcquiredAt: null,
						syncLeaseExpiresAt: null,
					})
					.where(
						and(
							eq(repositoryExternalSources.repositoryId, source.repositoryId),
							eq(repositoryExternalSources.syncLeaseOwner, leaseOwner)
						)
					)

				return undefined
			}

			// A worker that died mid-run left its attempt open, and nothing else ever
			// closes it: the lease it held has simply expired. Taking the lease is
			// the moment that becomes knowable, so the orphan is settled here rather
			// than by a reaper that would need the same evidence.
			await transaction
				.update(gitHubSyncAttempts)
				.set({
					status: 'interrupted',
					failureCode: GITHUB_SYNC_INTERRUPTED_CODES.leaseReclaimed,
					finishedAt: leaseAcquiredAt,
				})
				.where(
					and(
						eq(gitHubSyncAttempts.repositoryId, source.repositoryId),
						eq(gitHubSyncAttempts.status, 'running')
					)
				)

			return {
				repositoryId: source.repositoryId,
				externalSourceId: source.id,
				installationId: source.installationId,
				externalInstallationId: context.externalInstallationId,
				storagePath: context.storagePath,
				externalRepositoryId: source.externalRepositoryId,
				sourceUrl: source.sourceUrl,
				sourceDefaultBranch: source.sourceDefaultBranch,
				pullRequestSyncCursorAt: source.pullRequestSyncCursorAt ?? undefined,
				authorityGeneration: source.authorityGeneration,
				requestedSyncVersion: source.requestedSyncVersion,
				// The claim always takes the newest requested version, which may not
				// be the one the job was enqueued for, so provenance is read from the
				// source rather than from the wakeup that happened to win the race.
				trigger: source.trigger,
				replayDeliveryId: source.replayDeliveryId ?? undefined,
				leaseOwner,
			}
		})
	}

	async heartbeatSync({
		authorityGeneration,
		leaseExpiresAt,
		leaseOwner,
		repositoryId,
	}: Pick<
		GitHubSyncClaim,
		'repositoryId' | 'authorityGeneration' | 'leaseOwner'
	> & {
		leaseExpiresAt: Date
	}): Promise<boolean> {
		const [source] = await this.db
			.update(repositoryExternalSources)
			.set({ syncLeaseExpiresAt: leaseExpiresAt })
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(
						repositoryExternalSources.authorityGeneration,
						authorityGeneration
					),
					eq(repositoryExternalSources.syncLeaseOwner, leaseOwner)
				)
			)
			.returning({ id: repositoryExternalSources.id })

		return Boolean(source)
	}

	async finalizeSync({
		authorityGeneration,
		completedAt,
		defaultBranch,
		externalRepositoryNodeId,
		fullName,
		leaseOwner,
		name,
		nextSyncAt,
		ownerLogin,
		projectedNumbers,
		projectedShas,
		pullRequestSyncCursorAt,
		repositoryId,
		requestedSyncVersion,
		sourceDefaultBranch,
		sourceUrl,
		storagePath,
	}: FinalizeSyncParams): Promise<GitHubSyncRequest | undefined> {
		return await this.db.transaction(async transaction => {
			const [lockedSource] = await transaction
				.select({
					requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
				})
				.from(repositoryExternalSources)
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(
							repositoryExternalSources.authorityGeneration,
							authorityGeneration
						),
						eq(repositoryExternalSources.syncLeaseOwner, leaseOwner),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
					)
				)
				.limit(1)
				.for('update')

			if (!lockedSource) return undefined

			const hasFollowUp =
				lockedSource.requestedSyncVersion > requestedSyncVersion
			await transaction
				.update(repositories)
				.set({ defaultBranch, storagePath })
				.where(eq(repositories.id, repositoryId))
			await transaction
				.update(repositoryExternalSources)
				.set({
					externalRepositoryNodeId,
					ownerLogin,
					name,
					fullName,
					sourceUrl,
					sourceDefaultBranch,
					pullRequestSyncCursorAt,
					completedSyncVersion: requestedSyncVersion,
					syncStatus: hasFollowUp ? 'pending' : 'succeeded',
					lastSyncSucceededAt: completedAt,
					lastSyncFailedAt: null,
					nextSyncAt: hasFollowUp ? completedAt : nextSyncAt,
					syncFailureCount: 0,
					syncFailureCode: null,
					syncFailureReason: null,
					syncLeaseOwner: null,
					syncLeaseAcquiredAt: null,
					syncLeaseExpiresAt: null,
				})
				.where(eq(repositoryExternalSources.repositoryId, repositoryId))
			await transaction
				.update(gitHubWebhookDeliveries)
				.set({ status: 'processed', processedAt: completedAt })
				.where(
					and(
						eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
						eq(gitHubWebhookDeliveries.status, 'received'),
						lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion),
						or(
							// A delivery carries the only record of what it announced, so it
							// is consumed once its pull request has been projected. One
							// naming a pull request this mirror does not have is
							// unprojectable and would otherwise stay pending forever.
							and(
								isNull(gitHubWebhookDeliveries.targetSha),
								or(
									isNull(gitHubWebhookDeliveries.subjectNumber),
									projectedNumbers.length > 0
										? inArray(
												gitHubWebhookDeliveries.subjectNumber,
												projectedNumbers
											)
										: undefined,
									notExists(
										transaction
											.select({ id: gitHubPullRequestMappings.id })
											.from(gitHubPullRequestMappings)
											.where(
												and(
													eq(
														gitHubPullRequestMappings.repositoryId,
														repositoryId
													),
													eq(
														gitHubPullRequestMappings.externalNumber,
														gitHubWebhookDeliveries.subjectNumber
													)
												)
											)
									)
								)
							),
							// A check delivery names a commit and carries no pull request
							// number, so the rule above would consume it before its SHA was
							// ever reconciled. It waits for the projection to report that
							// SHA instead.
							projectedShas.length > 0
								? inArray(gitHubWebhookDeliveries.targetSha, projectedShas)
								: undefined
						)
					)
				)

			if (!hasFollowUp) return undefined

			// The dispatcher cannot raise the requested version while this run holds
			// the lease, so a version that arrived mid-run came from a delivery.
			return {
				repositoryId,
				authorityGeneration,
				requestedSyncVersion: lockedSource.requestedSyncVersion,
			}
		})
	}

	async failSync({
		authorityGeneration,
		failedAt,
		failureCode,
		failureReason,
		leaseOwner,
		nextSyncAt,
		repositoryId,
	}: FailSyncParams): Promise<void> {
		await this.db
			.update(repositoryExternalSources)
			.set({
				syncStatus: 'failed',
				lastSyncFailedAt: failedAt,
				nextSyncAt,
				syncFailureCount: sql`${repositoryExternalSources.syncFailureCount} + 1`,
				syncFailureCode: failureCode,
				syncFailureReason: failureReason,
				syncLeaseOwner: null,
				syncLeaseAcquiredAt: null,
				syncLeaseExpiresAt: null,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(
						repositoryExternalSources.authorityGeneration,
						authorityGeneration
					),
					eq(repositoryExternalSources.syncLeaseOwner, leaseOwner)
				)
			)
	}

	/**
	 * Ends a version that will never succeed as asked.
	 *
	 * A malformed provider payload or a resource GitHub no longer has is not
	 * something another try at the same version fixes, so the version is settled
	 * rather than left outstanding: `failSync` alone would leave
	 * `requested > completed`, and the dispatcher would hand the identical
	 * version back as a second attempt — contradicting the very outcome that said
	 * no attempt follows.
	 *
	 * The deliveries this run would have consumed are settled with it. They
	 * describe work no run can complete, and leaving them pending would block
	 * every later delivery behind them and hold health at `partial` forever.
	 * Marking them `failed` is also what makes them replayable once whatever
	 * broke is fixed.
	 */
	async terminalizeSync({
		authorityGeneration,
		failedAt,
		failureCode,
		failureReason,
		leaseOwner,
		nextSyncAt,
		repositoryId,
		requestedSyncVersion,
	}: TerminalizeSyncParams): Promise<void> {
		await this.db.transaction(async transaction => {
			const [settled] = await transaction
				.update(repositoryExternalSources)
				.set({
					syncStatus: 'failed',
					lastSyncFailedAt: failedAt,
					nextSyncAt,
					completedSyncVersion: requestedSyncVersion,
					syncFailureCount: sql`${repositoryExternalSources.syncFailureCount} + 1`,
					syncFailureCode: failureCode,
					syncFailureReason: failureReason,
					syncLeaseOwner: null,
					syncLeaseAcquiredAt: null,
					syncLeaseExpiresAt: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, repositoryId),
						eq(
							repositoryExternalSources.authorityGeneration,
							authorityGeneration
						),
						eq(repositoryExternalSources.syncLeaseOwner, leaseOwner)
					)
				)
				.returning({ id: repositoryExternalSources.id })

			if (!settled) return

			await transaction
				.update(gitHubWebhookDeliveries)
				.set({ status: 'failed', failedAt, failureCode })
				.where(
					and(
						eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
						eq(gitHubWebhookDeliveries.status, 'received'),
						lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion)
					)
				)
		})
	}

	/**
	 * Stops synchronizing until GitHub says access is back. Authentication loss
	 * is not a failure to retry: every retry spends a request that will be
	 * refused, so the source moves to the blocked status it already has, the
	 * schedule is cleared, and the authority generation is bumped so anything
	 * still in flight under the old one cannot write.
	 *
	 * The last synchronized data stays exactly where it is and stays readable.
	 */
	async blockSync({
		authorityGeneration,
		failedAt,
		failureCode,
		failureReason,
		leaseOwner,
		repositoryId,
	}: BlockSyncParams): Promise<void> {
		await this.db
			.update(repositoryExternalSources)
			.set({
				syncStatus: 'blocked',
				lastSyncFailedAt: failedAt,
				nextSyncAt: null,
				syncFailureCount: sql`${repositoryExternalSources.syncFailureCount} + 1`,
				syncFailureCode: failureCode,
				syncFailureReason: failureReason,
				authorityGeneration: sql`${repositoryExternalSources.authorityGeneration} + 1`,
				syncLeaseOwner: null,
				syncLeaseAcquiredAt: null,
				syncLeaseExpiresAt: null,
			})
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(
						repositoryExternalSources.authorityGeneration,
						authorityGeneration
					),
					eq(repositoryExternalSources.syncLeaseOwner, leaseOwner)
				)
			)
	}

	/**
	 * Opens the durable record of one reconciliation. The try counter is read and
	 * written in the same statement, which the repository lease already makes
	 * unambiguous: only the run holding it can be starting an attempt at this
	 * version.
	 */
	async startSyncAttempt({
		authorityGeneration,
		installationId,
		jobId,
		replayDeliveryId,
		repositoryId,
		requestedSyncVersion,
		startedAt,
		trigger,
	}: StartSyncAttemptParams): Promise<GitHubSyncAttemptId | undefined> {
		const [attempt] = await this.db
			.insert(gitHubSyncAttempts)
			.values({
				repositoryId,
				installationId,
				authorityGeneration,
				requestedSyncVersion,
				trigger,
				attemptNumber: sql`(
					select coalesce(max(${gitHubSyncAttempts.attemptNumber}), 0) + 1
					from ${gitHubSyncAttempts}
					where ${gitHubSyncAttempts.repositoryId} = ${repositoryId}
						and ${gitHubSyncAttempts.authorityGeneration} = ${authorityGeneration}
						and ${gitHubSyncAttempts.requestedSyncVersion} = ${requestedSyncVersion}
				)`,
				jobId,
				status: 'running',
				startedAt,
				replayDeliveryId,
			})
			.returning({ id: gitHubSyncAttempts.id })

		return attempt?.id
	}

	async completeSyncAttempt({
		attemptId,
		durationMs,
		failureClass,
		failureCode,
		finishedAt,
		retryAt,
		status,
	}: CompleteSyncAttemptParams): Promise<void> {
		await this.db
			.update(gitHubSyncAttempts)
			.set({
				status,
				failureClass,
				failureCode,
				finishedAt,
				durationMs,
				retryAt,
			})
			.where(eq(gitHubSyncAttempts.id, attemptId))
	}

	/**
	 * Records what GitHub said about this installation's budget. A defer is only
	 * ever extended, never shortened: several repositories share one installation
	 * and the longest wait any of them was told about is the one that holds.
	 *
	 * Nothing clears the defer, because a timestamp in the past already stops
	 * deferring — and clearing one on a response from a different rate-limit
	 * bucket would resume work GitHub is still refusing.
	 *
	 * The new deferral is written as an ISO string with an explicit cast rather
	 * than as a date: a raw parameter inside a fragment carries none of the
	 * column's type information, and the driver binds it as `timestamptz` against
	 * a `timestamp` column. `greatest` skips nulls on its own, so an installation
	 * that has never been deferred needs no coalesce.
	 */
	async recordInstallationRateLimit({
		installationId,
		observedAt,
		rateLimitedUntil,
		remaining,
	}: RecordInstallationRateLimitParams): Promise<void> {
		const observedAtSql = sql`${observedAt.toISOString()}::timestamp`

		await this.db
			.update(gitHubInstallations)
			.set({
				// Several repositories under one installation observe in parallel, so
				// the budget is only overwritten by an observation at least as recent
				// as the one already stored.
				...(remaining === undefined
					? {}
					: {
							rateLimitRemaining: sql`case when ${gitHubInstallations.rateLimitUpdatedAt} is null or ${gitHubInstallations.rateLimitUpdatedAt} <= ${observedAtSql} then ${remaining} else ${gitHubInstallations.rateLimitRemaining} end`,
						}),
				rateLimitUpdatedAt: sql`greatest(${gitHubInstallations.rateLimitUpdatedAt}, ${observedAtSql})`,
				...(rateLimitedUntil
					? {
							rateLimitedUntil: sql`greatest(${gitHubInstallations.rateLimitedUntil}, ${rateLimitedUntil.toISOString()}::timestamp)`,
						}
					: {}),
			})
			.where(eq(gitHubInstallations.id, installationId))
	}

	/**
	 * Keeps a receipt for a delivery whose signature was valid but whose payload
	 * Tessera could not read. Without it the only evidence GitHub ever tried is
	 * an HTTP status GitHub alone can see, and the pattern of malformed
	 * deliveries is exactly what an operator needs to notice.
	 *
	 * The row carries the schema paths that disagreed and nothing GitHub sent.
	 */
	async recordFailedWebhookDelivery({
		deliveryId,
		eventName,
		failedAt,
		failureCode,
		failureReason,
	}: RecordFailedWebhookDeliveryParams): Promise<void> {
		await this.db
			.insert(gitHubWebhookDeliveries)
			.values({
				id: deliveryId,
				eventName,
				status: 'failed',
				failedAt,
				failureCode,
				failureReason,
			})
			.onConflictDoNothing()
	}

	/**
	 * Re-arms a stored delivery for reconciliation under the current authority.
	 *
	 * Replay does not re-enter the webhook path, invent a delivery id, or need
	 * the raw payload: it hands the normal snapshot reconciliation a new version
	 * and puts the delivery back in the set that run will consume. A delivery
	 * that was already processed is deliberately re-armed, because bumping the
	 * version alone would reconcile the repository without ever revisiting the
	 * pull request or commit this delivery named.
	 *
	 * A blocked repository is refused: replay is a reconciliation trigger, not a
	 * way around lost access.
	 */
	async replayWebhookDelivery(
		deliveryId: GitHubWebhookDeliveryId
	): Promise<GitHubSyncRequest | undefined> {
		return await this.db.transaction(async transaction => {
			const [delivery] = await transaction
				.select({
					status: gitHubWebhookDeliveries.status,
					repositoryId: gitHubWebhookDeliveries.repositoryId,
					installationId: gitHubWebhookDeliveries.installationId,
				})
				.from(gitHubWebhookDeliveries)
				.where(eq(gitHubWebhookDeliveries.id, deliveryId))
				.limit(1)

			// An ignored delivery was never scoped to a synchronizing repository, so
			// there is no target to re-arm and nothing a run would do with it.
			if (!delivery?.repositoryId || delivery.status === 'ignored')
				return undefined

			// Locked the same way the webhook and rebind paths lock it, so the
			// installation compared against is the one that will still be current
			// when the version is raised.
			const [lockedSource] = await transaction
				.select({ installationId: repositoryExternalSources.installationId })
				.from(repositoryExternalSources)
				.where(
					eq(repositoryExternalSources.repositoryId, delivery.repositoryId)
				)
				.limit(1)
				.for('update')

			// A delivery received under one installation says nothing about a
			// repository that has since been rebound to another: replaying it would
			// reconcile under an authority that never saw the event it names.
			if (
				!lockedSource?.installationId ||
				lockedSource.installationId !== delivery.installationId
			)
				return undefined

			const [source] = await transaction
				.update(repositoryExternalSources)
				.set({
					requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
					requestedSyncTrigger: 'replay',
					requestedReplayDeliveryId: deliveryId,
					syncStatus: 'pending',
					// A replay commonly follows the terminal failure that settled this
					// delivery. Leaving that failure behind would have health report a
					// reason for a repository that is reconciling again, so the raise
					// clears it exactly as the webhook and resume paths do.
					syncFailureCode: null,
					syncFailureReason: null,
					nextSyncAt: new Date(),
				})
				.where(
					and(
						eq(repositoryExternalSources.repositoryId, delivery.repositoryId),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
						isNotNull(repositoryExternalSources.installationId),
						ne(repositoryExternalSources.syncStatus, 'blocked')
					)
				)
				.returning({
					repositoryId: repositoryExternalSources.repositoryId,
					authorityGeneration: repositoryExternalSources.authorityGeneration,
					requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
				})

			if (!source) return undefined

			await transaction
				.update(gitHubWebhookDeliveries)
				.set({
					status: 'received',
					syncVersion: source.requestedSyncVersion,
					processedAt: null,
					failedAt: null,
					failureCode: null,
					failureReason: null,
				})
				.where(eq(gitHubWebhookDeliveries.id, deliveryId))

			return source
		})
	}

	async requestDueReconciliations({
		limit,
		now,
	}: {
		limit: number
		now: Date
	}): Promise<GitHubSyncRequest[]> {
		return await this.db.transaction(async transaction => {
			const dueSources = await transaction
				.select({
					repositoryId: repositoryExternalSources.repositoryId,
					authorityGeneration: repositoryExternalSources.authorityGeneration,
					requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
					completedSyncVersion: repositoryExternalSources.completedSyncVersion,
				})
				.from(repositoryExternalSources)
				.where(
					and(
						eq(repositoryExternalSources.provider, 'github'),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera'),
						isNotNull(repositoryExternalSources.installationId),
						lte(repositoryExternalSources.nextSyncAt, now),
						or(
							isNull(repositoryExternalSources.syncLeaseOwner),
							lt(repositoryExternalSources.syncLeaseExpiresAt, now)
						),
						isNotRateLimitedInstallation(transaction, now)
					)
				)
				.orderBy(asc(repositoryExternalSources.nextSyncAt))
				.limit(limit)
				.for('update', { skipLocked: true })

			const requests: GitHubSyncRequest[] = []
			for (const source of dueSources) {
				if (source.requestedSyncVersion > source.completedSyncVersion) {
					requests.push({
						repositoryId: source.repositoryId,
						authorityGeneration: source.authorityGeneration,
						requestedSyncVersion: source.requestedSyncVersion,
					})
					continue
				}

				const [request] = await transaction
					.update(repositoryExternalSources)
					.set({
						requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
						requestedSyncTrigger: 'scheduled',
						requestedReplayDeliveryId: null,
						syncStatus: 'pending',
					})
					.where(
						and(
							eq(repositoryExternalSources.repositoryId, source.repositoryId),
							eq(
								repositoryExternalSources.authorityGeneration,
								source.authorityGeneration
							)
						)
					)
					.returning({
						repositoryId: repositoryExternalSources.repositoryId,
						authorityGeneration: repositoryExternalSources.authorityGeneration,
						requestedSyncVersion:
							repositoryExternalSources.requestedSyncVersion,
					})

				if (request) requests.push(request)
			}

			return requests
		})
	}

	private async applyInstallationChanges(
		transaction: DrizzleTransaction,
		{
			action,
			addedRepositories = [],
			installationId,
			removedRepositories = [],
		}: {
			action?: string
			addedRepositories?: GitHubInstallationRepositoryInput[]
			installationId: GitHubInstallationId
			removedRepositories?: GitHubInstallationRepositoryInput[]
		}
	): Promise<GitHubSyncRequest[]> {
		const syncRequests: GitHubSyncRequest[] = []

		if (action === 'deleted') {
			await transaction
				.update(repositoryExternalSources)
				.set({
					installationId: null,
					syncStatus: 'blocked',
					syncFailureCode: 'missing_installation',
					syncFailureReason:
						'Install the Tessera GitHub App to resume synchronization.',
					nextSyncAt: null,
					authorityGeneration: sql`${repositoryExternalSources.authorityGeneration} + 1`,
					syncLeaseOwner: null,
					syncLeaseAcquiredAt: null,
					syncLeaseExpiresAt: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.installationId, installationId),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
					)
				)
			await transaction
				.update(repositoryExternalSources)
				.set({ installationId: null })
				.where(eq(repositoryExternalSources.installationId, installationId))
			await transaction
				.update(gitHubInstallations)
				.set({ deletedAt: new Date() })
				.where(eq(gitHubInstallations.id, installationId))

			return syncRequests
		}

		if (action === 'suspend') {
			await transaction
				.update(repositoryExternalSources)
				.set({
					syncStatus: 'blocked',
					syncFailureCode: 'installation_suspended',
					syncFailureReason:
						'The Tessera GitHub App installation is suspended. Restore the installation to resume synchronization.',
					nextSyncAt: null,
					authorityGeneration: sql`${repositoryExternalSources.authorityGeneration} + 1`,
					syncLeaseOwner: null,
					syncLeaseAcquiredAt: null,
					syncLeaseExpiresAt: null,
				})
				.where(
					and(
						eq(repositoryExternalSources.installationId, installationId),
						eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
					)
				)

			return syncRequests
		}

		for (const repository of removedRepositories)
			await this.removeInstallationRepository(transaction, {
				installationId,
				repository,
			})

		for (const repository of addedRepositories) {
			const request = await this.addInstallationRepository(transaction, {
				installationId,
				repository,
			})

			if (request) syncRequests.push(request)
		}

		if (action === 'unsuspend') {
			const resumedRequests = await this.resumeInstallationRepositories(
				transaction,
				installationId
			)
			syncRequests.push(...resumedRequests)
		}

		return syncRequests
	}

	private async addInstallationRepository(
		transaction: DrizzleTransaction,
		{
			installationId,
			repository,
		}: {
			installationId: GitHubInstallationId
			repository: GitHubInstallationRepositoryInput
		}
	): Promise<GitHubSyncRequest | undefined> {
		const [source] = await transaction
			.select({
				repositoryId: repositoryExternalSources.repositoryId,
				mirrorMode: repositoryExternalSources.mirrorMode,
			})
			.from(repositoryExternalSources)
			.where(
				and(
					eq(repositoryExternalSources.provider, 'github'),
					or(
						eq(
							repositoryExternalSources.externalRepositoryId,
							BigInt(repository.id)
						),
						eq(
							repositoryExternalSources.externalRepositoryNodeId,
							repository.node_id
						)
					)
				)
			)
			.limit(1)
			.for('update')

		if (!source) return undefined

		const [updatedSource] = await transaction
			.update(repositoryExternalSources)
			.set({
				installationId,
				externalRepositoryNodeId: repository.node_id,
				...(source.mirrorMode === 'github_to_tessera'
					? {
							requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
							requestedSyncTrigger: 'webhook' as const,
							requestedReplayDeliveryId: null,
							syncStatus: 'pending' as const,
							syncFailureCode: null,
							syncFailureReason: null,
							nextSyncAt: new Date(),
						}
					: {}),
			})
			.where(eq(repositoryExternalSources.repositoryId, source.repositoryId))
			.returning({
				repositoryId: repositoryExternalSources.repositoryId,
				authorityGeneration: repositoryExternalSources.authorityGeneration,
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})

		if (!(source.mirrorMode === 'github_to_tessera' && updatedSource))
			return undefined

		return updatedSource
	}

	private async removeInstallationRepository(
		transaction: DrizzleTransaction,
		{
			installationId,
			repository,
		}: {
			installationId: GitHubInstallationId
			repository: GitHubInstallationRepositoryInput
		}
	): Promise<void> {
		await transaction
			.update(repositoryExternalSources)
			.set({
				installationId: null,
				syncStatus: 'blocked',
				syncFailureCode: 'missing_installation',
				syncFailureReason:
					'Grant the Tessera GitHub App access to resume synchronization.',
				nextSyncAt: null,
				authorityGeneration: sql`${repositoryExternalSources.authorityGeneration} + 1`,
				syncLeaseOwner: null,
				syncLeaseAcquiredAt: null,
				syncLeaseExpiresAt: null,
			})
			.where(
				and(
					eq(repositoryExternalSources.installationId, installationId),
					eq(
						repositoryExternalSources.externalRepositoryId,
						BigInt(repository.id)
					),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
	}

	private async resumeInstallationRepositories(
		transaction: DrizzleTransaction,
		installationId: GitHubInstallationId
	): Promise<GitHubSyncRequest[]> {
		const resumedSources = await transaction
			.update(repositoryExternalSources)
			.set({
				requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
				requestedSyncTrigger: 'webhook',
				requestedReplayDeliveryId: null,
				syncStatus: 'pending',
				syncFailureCode: null,
				syncFailureReason: null,
				nextSyncAt: new Date(),
			})
			.where(
				and(
					eq(repositoryExternalSources.installationId, installationId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
			.returning({
				repositoryId: repositoryExternalSources.repositoryId,
				authorityGeneration: repositoryExternalSources.authorityGeneration,
				requestedSyncVersion: repositoryExternalSources.requestedSyncVersion,
			})

		return resumedSources
	}

	private async upsertInstallation(
		db: DrizzleTransaction,
		{
			accountLogin,
			accountNodeId,
			externalInstallationId,
			suspendedAt,
			targetType,
		}: GitHubInstallationDetailsInput
	): Promise<ResolvedGitHubInstallation> {
		const [installation] = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId,
				accountNodeId,
				accountLogin,
				targetType,
				suspendedAt,
			})
			.onConflictDoUpdate({
				target: gitHubInstallations.externalInstallationId,
				set: { accountNodeId, accountLogin, targetType, suspendedAt },
			})
			.returning({
				id: gitHubInstallations.id,
				suspendedAt: gitHubInstallations.suspendedAt,
			})

		if (!installation) throw new Error('failed to persist GitHub installation')

		return {
			id: installation.id,
			suspendedAt: installation.suspendedAt ?? undefined,
		}
	}

	private async resolveInstallation(
		db: DrizzleTransaction,
		installation: GitHubInstallationInput
	): Promise<ResolvedGitHubInstallation | undefined> {
		await db.execute(
			sql`select pg_advisory_xact_lock(hashtextextended(${`github_installation:${installation.externalInstallationId}`}, 0))`
		)

		const [existingInstallation] = await db
			.select({
				id: gitHubInstallations.id,
				suspendedAt: gitHubInstallations.suspendedAt,
				deletedAt: gitHubInstallations.deletedAt,
			})
			.from(gitHubInstallations)
			.where(
				eq(
					gitHubInstallations.externalInstallationId,
					installation.externalInstallationId
				)
			)
			.limit(1)

		if (existingInstallation?.deletedAt) return undefined
		if ('accountNodeId' in installation)
			return await this.upsertInstallation(db, installation)
		if (!existingInstallation) return undefined

		if (installation.suspendedAt !== undefined) {
			await db
				.update(gitHubInstallations)
				.set({ suspendedAt: installation.suspendedAt })
				.where(eq(gitHubInstallations.id, existingInstallation.id))

			return {
				id: existingInstallation.id,
				suspendedAt: installation.suspendedAt ?? undefined,
			}
		}

		return {
			id: existingInstallation.id,
			suspendedAt: existingInstallation.suspendedAt ?? undefined,
		}
	}
}

import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type {
	DrizzleTransaction,
	GitHubActorId,
	GitHubInstallationId,
	GitHubWebhookDeliveryId,
	RepositoryExternalSourceId,
} from '@repo/db'
import {
	account,
	and,
	asc,
	eq,
	gitHubActors,
	gitHubInstallations,
	gitHubWebhookDeliveries,
	gte,
	isNotNull,
	isNull,
	lt,
	lte,
	or,
	repositories,
	repositoryExternalSources,
	sql,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import type { SQL } from 'drizzle-orm'
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
	sender?: GitHubSyncActor
	targetActor?: GitHubSyncActor
	labelNodeId?: string
	labelName?: string
	addedInstallationRepositories?: GitHubInstallationRepositoryInput[]
	removedInstallationRepositories?: GitHubInstallationRepositoryInput[]
}

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

export interface GitHubSyncClaim extends GitHubSyncRequest {
	externalSourceId: RepositoryExternalSourceId
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

@Injectable()
export class GitHubSyncRepository {
	constructor(private readonly db: Database) {}

	async upsertActors(
		actors: GitHubSyncActor[]
	): Promise<Map<string, GitHubActorId>> {
		return await this.db.transaction(async transaction => {
			const actorIds = new Map<string, GitHubActorId>()

			for (const actor of actors)
				actorIds.set(actor.nodeId, await this.upsertActor(transaction, actor))

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
			sender ? this.upsertActor(transaction, sender) : undefined,
			targetActor ? this.upsertActor(transaction, targetActor) : undefined,
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
						)
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
						lte(gitHubWebhookDeliveries.syncVersion, requestedSyncVersion)
					)
				)

			if (!hasFollowUp) return undefined

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
						)
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

		return source.mirrorMode === 'github_to_tessera' ? updatedSource : undefined
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
		return await transaction
			.update(repositoryExternalSources)
			.set({
				requestedSyncVersion: sql`${repositoryExternalSources.requestedSyncVersion} + 1`,
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

	private async upsertActor(
		db: DrizzleTransaction,
		actor: GitHubSyncActor
	): Promise<GitHubActorId> {
		const [linkedAccount] = await db
			.select({ userId: account.userId })
			.from(account)
			.where(
				and(
					eq(account.providerId, 'github'),
					eq(account.accountId, actor.numericId.toString())
				)
			)
			.limit(1)
		const actorValues = {
			externalNodeId: actor.nodeId,
			externalNumericId: actor.numericId,
			login: actor.login,
			type: actor.type,
			avatarUrl: actor.avatarUrl,
			htmlUrl: actor.htmlUrl,
			userId: linkedAccount?.userId,
		}

		const [insertedActor] = await db
			.insert(gitHubActors)
			.values(actorValues)
			.onConflictDoNothing()
			.returning({ id: gitHubActors.id })

		if (insertedActor) return insertedActor.id

		const [existingActor] = await db
			.select({ id: gitHubActors.id })
			.from(gitHubActors)
			.where(
				or(
					eq(gitHubActors.externalNodeId, actor.nodeId),
					eq(gitHubActors.externalNumericId, actor.numericId)
				)
			)
			.limit(1)

		if (!existingActor) throw new Error('failed to resolve GitHub actor')

		const [storedActor] = await db
			.update(gitHubActors)
			.set(actorValues)
			.where(eq(gitHubActors.id, existingActor.id))
			.returning({ id: gitHubActors.id })

		if (!storedActor) throw new Error('failed to persist GitHub actor')

		return storedActor.id
	}
}

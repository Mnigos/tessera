import { Database } from '@config/database'
import { ChecksProjectionService } from '@modules/checks'
import { Injectable } from '@nestjs/common'
import type { CheckKind } from '@repo/contracts'
import {
	and,
	type DrizzleTransaction,
	eq,
	type GitHubActorId,
	type GitHubCheckSuiteMappingId,
	gitHubCheckRunMappings,
	gitHubCheckSuiteMappings,
	gitHubCommitStatusMappings,
	gitHubPullRequestMappings,
	isNull,
	notInArray,
	sql,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import {
	toNativeCheckState,
	toNativeCommitStatusState,
} from '../application/github-check-state.mapper'
import { preserveCheckMappingProvenance } from '../helpers/github-check-mapping'
import {
	boundCheckOutputSummary,
	sortCommitStatusesChronologically,
	toCheckRunFingerprint,
	toCommitStatusFingerprint,
} from '../helpers/github-check-observation'
import type {
	GitHubChecksSnapshot,
	GitHubSyncCheckApp,
	GitHubSyncCheckRun,
	GitHubSyncCommitStatus,
} from './github-sync.client.types'
import type { GitHubPendingCheckDelivery } from './github-sync.repository'
import { assertGitHubSyncAuthority } from './github-sync-authority'

export interface ProjectChecksForShaParams {
	actorIds: Map<string, GitHubActorId>
	authorityGeneration: number
	deliveries: GitHubPendingCheckDelivery[]
	leaseOwner: string
	repositoryId: RepositoryId
	sha: string
	snapshot: GitHubChecksSnapshot
	syncedAt: Date
	syncVersion: number
}

/** A provider value the state mapper had no mapping for, worth reporting once. */
export interface GitHubUnrecognizedCheckResult {
	kind: CheckKind
	context: string
	unrecognized: string
}

export interface GitHubChecksProjectionResult {
	appendedObservations: number
	unrecognizedResults: GitHubUnrecognizedCheckResult[]
}

interface ChecksProjectionContext extends ProjectChecksForShaParams {
	suiteMappingIds: Map<string, GitHubCheckSuiteMappingId>
	transaction: DrizzleTransaction
	result: GitHubChecksProjectionResult
}

@Injectable()
export class GitHubSyncChecksRepository {
	constructor(
		private readonly checksProjectionService: ChecksProjectionService,
		private readonly db: Database
	) {}

	/**
	 * Projects everything GitHub reports for one commit.
	 *
	 * Absence never deletes here. GitHub prunes old check runs once a name
	 * accumulates history, so a result missing from the snapshot is not evidence
	 * it was withdrawn — the mapping records that the provider stopped listing it
	 * and the native ledger keeps every page it ever wrote.
	 */
	async projectChecksForSha(
		params: ProjectChecksForShaParams
	): Promise<GitHubChecksProjectionResult> {
		return await this.db.transaction(async transaction => {
			// Checks are scoped to a commit, so two runs racing over the same commit
			// serialize here even when they arrived through different pull requests.
			await transaction.execute(
				sql`select pg_advisory_xact_lock(hashtextextended(${`${params.repositoryId}:${params.sha}`}, 0))`
			)
			await assertGitHubSyncAuthority(transaction, params)

			const context: ChecksProjectionContext = {
				...params,
				suiteMappingIds: new Map(),
				transaction,
				result: { appendedObservations: 0, unrecognizedResults: [] },
			}

			await this.projectSuites(context)
			await this.projectRuns(context)
			await this.projectStatuses(context)
			await this.markAbsentMappings(context)
			await this.advanceChecksCursor(context)

			return context.result
		})
	}

	/**
	 * A suite is provider grouping rather than a result, so it projects no native
	 * row — the mapping exists to keep run identity resolvable and to snapshot the
	 * app that produced the runs.
	 */
	private async projectSuites(context: ChecksProjectionContext): Promise<void> {
		for (const suite of context.snapshot.suites) {
			const { repositoryId, syncedAt, syncVersion, transaction } = context
			const delivery = findCheckDelivery(context.deliveries, {
				kind: 'check_suite',
				nodeId: suite.nodeId,
				numericId: suite.numericId,
			})
			const [existing] = await transaction
				.select({
					id: gitHubCheckSuiteMappings.id,
					provenance: {
						appExternalNumericId: gitHubCheckSuiteMappings.appExternalNumericId,
						appExternalNodeId: gitHubCheckSuiteMappings.appExternalNodeId,
						appSlug: gitHubCheckSuiteMappings.appSlug,
						appName: gitHubCheckSuiteMappings.appName,
						appHtmlUrl: gitHubCheckSuiteMappings.appHtmlUrl,
						providerCreatedAt: gitHubCheckSuiteMappings.providerCreatedAt,
						deliveryId: gitHubCheckSuiteMappings.deliveryId,
					},
				})
				.from(gitHubCheckSuiteMappings)
				.where(eq(gitHubCheckSuiteMappings.externalNodeId, suite.nodeId))
				.limit(1)
			const values = {
				repositoryId,
				externalNodeId: suite.nodeId,
				externalNumericId: suite.numericId,
				headSha: suite.headSha,
				rawStatus: suite.status ?? null,
				rawConclusion: suite.conclusion ?? null,
				providerUpdatedAt: suite.updatedAt ?? null,
				providerMissingAt: null,
				lastSeenSyncVersion: syncVersion,
				updatedAt: syncedAt,
				...preserveCheckMappingProvenance(existing?.provenance, {
					...toAppSnapshot(suite.app),
					providerCreatedAt: suite.createdAt ?? null,
					deliveryId: delivery?.deliveryId ?? null,
				}),
			}

			if (existing) {
				await transaction
					.update(gitHubCheckSuiteMappings)
					.set(values)
					.where(eq(gitHubCheckSuiteMappings.id, existing.id))
				context.suiteMappingIds.set(suite.nodeId, existing.id)
				continue
			}

			const [inserted] = await transaction
				.insert(gitHubCheckSuiteMappings)
				.values(values)
				.returning({ id: gitHubCheckSuiteMappings.id })

			if (inserted) context.suiteMappingIds.set(suite.nodeId, inserted.id)
		}
	}

	private async projectRuns(context: ChecksProjectionContext): Promise<void> {
		for (const run of context.snapshot.runs) await this.projectRun(context, run)
	}

	/**
	 * One run identity is one native check for its whole lifecycle: queued,
	 * running and finished are pages in the same logbook. A rerun GitHub reports
	 * under a new run ID gets a check of its own and supersedes the one it
	 * replaced through the effective-result ordering, without either being
	 * rewritten.
	 */
	private async projectRun(
		context: ChecksProjectionContext,
		run: GitHubSyncCheckRun
	): Promise<void> {
		const { repositoryId, sha, syncedAt, syncVersion, transaction } = context
		const [existing] = await transaction
			.select({
				id: gitHubCheckRunMappings.id,
				checkId: gitHubCheckRunMappings.checkId,
				provenance: {
					appExternalNumericId: gitHubCheckRunMappings.appExternalNumericId,
					appExternalNodeId: gitHubCheckRunMappings.appExternalNodeId,
					appSlug: gitHubCheckRunMappings.appSlug,
					appName: gitHubCheckRunMappings.appName,
					appHtmlUrl: gitHubCheckRunMappings.appHtmlUrl,
					deliveryId: gitHubCheckRunMappings.deliveryId,
				},
			})
			.from(gitHubCheckRunMappings)
			.where(eq(gitHubCheckRunMappings.externalNodeId, run.nodeId))
			.limit(1)

		const { state, unrecognized } = toNativeCheckState({
			conclusion: run.conclusion,
			status: run.status,
		})

		if (unrecognized)
			context.result.unrecognizedResults.push({
				kind: 'check_run',
				context: run.name,
				unrecognized,
			})

		const checkId = await this.checksProjectionService.resolveCheck(
			{
				repositoryId,
				sha,
				kind: 'check_run',
				context: run.name,
				existingCheckId: existing?.checkId ?? undefined,
			},
			transaction
		)
		const delivery = findCheckDelivery(context.deliveries, {
			kind: 'check_run',
			nodeId: run.nodeId,
			numericId: run.numericId,
		})
		const observationId = await this.checksProjectionService.appendObservation(
			{
				repositoryId,
				checkId,
				state,
				rawStatus: run.status,
				rawConclusion: run.conclusion,
				targetUrl: run.detailsUrl ?? run.htmlUrl,
				outputTitle: run.outputTitle,
				outputSummary: boundCheckOutputSummary(run.outputSummary),
				// Kept for display and for anyone reading the ledger; the effective
				// result never ranks by it, because a requeued run reports neither a
				// start nor a completion.
				providerCreatedAt: run.completedAt ?? run.startedAt,
				startedAt: run.startedAt,
				completedAt: run.completedAt,
				observedAt: syncedAt,
				syncVersion,
				deliveryId: delivery?.deliveryId,
				fingerprint: toCheckRunFingerprint(run),
			},
			transaction
		)

		if (observationId) context.result.appendedObservations += 1

		const values = {
			repositoryId,
			checkSuiteMappingId: run.suiteNodeId
				? (context.suiteMappingIds.get(run.suiteNodeId) ?? null)
				: null,
			checkId,
			externalNodeId: run.nodeId,
			externalNumericId: run.numericId,
			name: run.name,
			headSha: run.headSha,
			externalId: run.externalId ?? null,
			detailsUrl: run.detailsUrl ?? null,
			htmlUrl: run.htmlUrl ?? null,
			providerStartedAt: run.startedAt ?? null,
			providerCompletedAt: run.completedAt ?? null,
			providerMissingAt: null,
			lastSeenSyncVersion: syncVersion,
			updatedAt: syncedAt,
			...preserveCheckMappingProvenance(existing?.provenance, {
				...toAppSnapshot(run.app),
				deliveryId: delivery?.deliveryId ?? null,
			}),
		}

		if (existing) {
			await transaction
				.update(gitHubCheckRunMappings)
				.set(values)
				.where(eq(gitHubCheckRunMappings.id, existing.id))
			return
		}

		await transaction.insert(gitHubCheckRunMappings).values(values)
	}

	/**
	 * GitHub lists a context's statuses newest first. The ledger's own append
	 * order is what the effective-result query reads, so the stream is replayed
	 * oldest first and the newest post is the last page written rather than the
	 * first.
	 */
	private async projectStatuses(
		context: ChecksProjectionContext
	): Promise<void> {
		for (const status of sortCommitStatusesChronologically(
			context.snapshot.statuses
		))
			await this.projectStatus(context, status)
	}

	/**
	 * Every status posted against a context joins one stream, so the check is
	 * shared and the mapping points at the individual observation this post
	 * produced.
	 */
	private async projectStatus(
		context: ChecksProjectionContext,
		status: GitHubSyncCommitStatus
	): Promise<void> {
		const { repositoryId, sha, syncedAt, syncVersion, transaction } = context
		const [existing] = await transaction
			.select({
				id: gitHubCommitStatusMappings.id,
				checkObservationId: gitHubCommitStatusMappings.checkObservationId,
				provenance: {
					creatorActorId: gitHubCommitStatusMappings.creatorActorId,
					providerCreatedAt: gitHubCommitStatusMappings.providerCreatedAt,
					deliveryId: gitHubCommitStatusMappings.deliveryId,
				},
			})
			.from(gitHubCommitStatusMappings)
			.where(eq(gitHubCommitStatusMappings.externalNodeId, status.nodeId))
			.limit(1)

		const { state, unrecognized } = toNativeCommitStatusState(status.state)

		if (unrecognized)
			context.result.unrecognizedResults.push({
				kind: 'status',
				context: status.context,
				unrecognized,
			})

		const checkId = await this.checksProjectionService.resolveCheck(
			{ repositoryId, sha, kind: 'status', context: status.context },
			transaction
		)
		const delivery = findCheckDelivery(context.deliveries, {
			kind: 'commit_status',
			nodeId: status.nodeId,
			numericId: status.numericId,
		})
		const observationId = await this.checksProjectionService.appendObservation(
			{
				repositoryId,
				checkId,
				state,
				rawStatus: status.state,
				targetUrl: status.targetUrl,
				description: status.description,
				providerCreatedAt: status.createdAt,
				observedAt: syncedAt,
				syncVersion,
				deliveryId: delivery?.deliveryId,
				fingerprint: toCommitStatusFingerprint({ repositoryId, sha, status }),
			},
			transaction
		)

		if (observationId) context.result.appendedObservations += 1

		const values = {
			repositoryId,
			checkId,
			// A replayed status appends nothing, so the mapping keeps pointing at the
			// observation its first sighting wrote.
			checkObservationId: observationId ?? existing?.checkObservationId ?? null,
			externalNodeId: status.nodeId,
			externalNumericId: status.numericId,
			sha,
			context: status.context,
			rawState: status.state,
			targetUrl: status.targetUrl ?? null,
			description: status.description ?? null,
			providerUpdatedAt: status.updatedAt,
			providerMissingAt: null,
			lastSeenSyncVersion: syncVersion,
			updatedAt: syncedAt,
			...preserveCheckMappingProvenance(existing?.provenance, {
				creatorActorId: status.creator
					? (context.actorIds.get(status.creator.nodeId) ?? null)
					: null,
				providerCreatedAt: status.createdAt,
				deliveryId: delivery?.deliveryId ?? null,
			}),
		}

		if (existing) {
			await transaction
				.update(gitHubCommitStatusMappings)
				.set(values)
				.where(eq(gitHubCommitStatusMappings.id, existing.id))
			return
		}

		await transaction.insert(gitHubCommitStatusMappings).values(values)
	}

	/**
	 * Records that the provider stopped listing a result for this commit. The
	 * native check and its observations are untouched: a pruned run is still a
	 * run that happened.
	 */
	private async markAbsentMappings({
		repositoryId,
		sha,
		snapshot,
		syncedAt,
		transaction,
	}: ChecksProjectionContext): Promise<void> {
		const suiteNodeIds = snapshot.suites.map(suite => suite.nodeId)
		const runNodeIds = snapshot.runs.map(run => run.nodeId)
		const statusNodeIds = snapshot.statuses.map(status => status.nodeId)

		await transaction
			.update(gitHubCheckSuiteMappings)
			.set({ providerMissingAt: syncedAt })
			.where(
				and(
					eq(gitHubCheckSuiteMappings.repositoryId, repositoryId),
					eq(gitHubCheckSuiteMappings.headSha, sha),
					isNull(gitHubCheckSuiteMappings.providerMissingAt),
					suiteNodeIds.length > 0
						? notInArray(gitHubCheckSuiteMappings.externalNodeId, suiteNodeIds)
						: undefined
				)
			)
		await transaction
			.update(gitHubCheckRunMappings)
			.set({ providerMissingAt: syncedAt })
			.where(
				and(
					eq(gitHubCheckRunMappings.repositoryId, repositoryId),
					eq(gitHubCheckRunMappings.headSha, sha),
					isNull(gitHubCheckRunMappings.providerMissingAt),
					runNodeIds.length > 0
						? notInArray(gitHubCheckRunMappings.externalNodeId, runNodeIds)
						: undefined
				)
			)
		await transaction
			.update(gitHubCommitStatusMappings)
			.set({ providerMissingAt: syncedAt })
			.where(
				and(
					eq(gitHubCommitStatusMappings.repositoryId, repositoryId),
					eq(gitHubCommitStatusMappings.sha, sha),
					isNull(gitHubCommitStatusMappings.providerMissingAt),
					statusNodeIds.length > 0
						? notInArray(
								gitHubCommitStatusMappings.externalNodeId,
								statusNodeIds
							)
						: undefined
				)
			)
	}

	/**
	 * The repair cursor advances for every pull request currently pointing at this
	 * commit, which is what keeps a head shared by several pull requests from
	 * being reconciled once per pull request.
	 */
	private async advanceChecksCursor({
		repositoryId,
		sha,
		syncedAt,
		transaction,
	}: ChecksProjectionContext): Promise<void> {
		await transaction
			.update(gitHubPullRequestMappings)
			.set({ checksSyncedAt: syncedAt })
			.where(
				and(
					eq(gitHubPullRequestMappings.repositoryId, repositoryId),
					eq(gitHubPullRequestMappings.headSha, sha)
				)
			)
	}
}

/**
 * The delivery that announced this result, when one did. It travels onto the
 * observation as provenance; whether the delivery may be consumed is decided by
 * the SHA the run projected, not by this match.
 */
function findCheckDelivery(
	deliveries: GitHubPendingCheckDelivery[],
	{
		kind,
		nodeId,
		numericId,
	}: {
		kind: 'check_suite' | 'check_run' | 'commit_status'
		nodeId: string
		numericId: bigint
	}
): GitHubPendingCheckDelivery | undefined {
	return deliveries.find(
		delivery =>
			delivery.targetResourceKind === kind &&
			(delivery.targetResourceNodeId === nodeId ||
				delivery.targetResourceNumericId === numericId)
	)
}

function toAppSnapshot(app?: GitHubSyncCheckApp) {
	return {
		appExternalNumericId: app?.numericId ?? null,
		appExternalNodeId: app?.nodeId ?? null,
		appSlug: app?.slug ?? null,
		appName: app?.name ?? null,
		appHtmlUrl: app?.htmlUrl ?? null,
	}
}

import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import {
	and,
	desc,
	eq,
	gitHubInstallations,
	gitHubSyncAttempts,
	gitHubWebhookDeliveries,
	gte,
	isNotNull,
	repositoryExternalSources,
	sql,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import type { RepositorySyncHealthFacts } from '../domain/repository-sync-health'

const HEALTH_WINDOW_HOURS = 24

@Injectable()
export class RepositorySyncHealthRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Everything the sync-health read model derives from, in one round trip.
	 *
	 * This does not ride the repository read path. Health costs three index
	 * lookups the ordinary repository page has no use for, so it is asked for
	 * separately by the surfaces that show it rather than paid for by every
	 * reader of a repository.
	 */
	async findFacts({
		now,
		repositoryId,
	}: {
		now: Date
		repositoryId: RepositoryId
	}): Promise<RepositorySyncHealthFacts | undefined> {
		const windowStartedAt = new Date(
			now.getTime() - HEALTH_WINDOW_HOURS * 60 * 60 * 1000
		)
		const deliveries = this.db
			.select({
				pendingCount: sql<number>`count(*)::int`.as('pending_count'),
				oldestPendingAt:
					sql<Date | null>`min(${gitHubWebhookDeliveries.receivedAt})`.as(
						'oldest_pending_at'
					),
			})
			.from(gitHubWebhookDeliveries)
			.where(
				and(
					eq(gitHubWebhookDeliveries.repositoryId, repositoryId),
					eq(gitHubWebhookDeliveries.status, 'received')
				)
			)
			.as('deliveries')
		const attemptWindow = this.db
			.select({
				retryCount:
					sql<number>`count(*) filter (where ${gitHubSyncAttempts.status} = 'retry_scheduled')::int`.as(
						'retry_count'
					),
				terminalCount:
					sql<number>`count(*) filter (where ${gitHubSyncAttempts.status} in ('terminal_failed', 'blocked'))::int`.as(
						'terminal_count'
					),
				// Operations that reached a verdict, which is what a failure rate is
				// measured against. A retry is the same operation being tried again,
				// so counting each try would report one operation that failed after
				// four retries as an eighty-percent success rate; a run that was
				// interrupted or is still going decided nothing at all.
				completedCount:
					sql<number>`count(*) filter (where ${gitHubSyncAttempts.status} in ('succeeded', 'partial', 'terminal_failed', 'blocked'))::int`.as(
						'completed_count'
					),
			})
			.from(gitHubSyncAttempts)
			.where(
				and(
					eq(gitHubSyncAttempts.repositoryId, repositoryId),
					gte(gitHubSyncAttempts.startedAt, windowStartedAt)
				)
			)
			.as('attempt_window')
		// The newest attempt that reached an outcome. A run still going says nothing
		// about whether the last one converged, and it has no duration yet, so
		// including it would blank both fields for as long as it lasts.
		const latestAttempt = this.db
			.select({
				status: gitHubSyncAttempts.status,
				durationMs: gitHubSyncAttempts.durationMs,
			})
			.from(gitHubSyncAttempts)
			.where(
				and(
					eq(gitHubSyncAttempts.repositoryId, repositoryId),
					isNotNull(gitHubSyncAttempts.finishedAt)
				)
			)
			.orderBy(desc(gitHubSyncAttempts.finishedAt))
			.limit(1)
			.as('latest_attempt')

		const [facts] = await this.db
			.select({
				syncStatus: repositoryExternalSources.syncStatus,
				lastSyncSucceededAt: repositoryExternalSources.lastSyncSucceededAt,
				syncFailureCode: repositoryExternalSources.syncFailureCode,
				syncFailureReason: repositoryExternalSources.syncFailureReason,
				rateLimitedUntil: gitHubInstallations.rateLimitedUntil,
				pendingDeliveryCount: deliveries.pendingCount,
				oldestPendingDeliveryAt: deliveries.oldestPendingAt,
				retryCount24h: attemptWindow.retryCount,
				terminalCount24h: attemptWindow.terminalCount,
				completedCount24h: attemptWindow.completedCount,
				latestAttemptStatus: latestAttempt.status,
				lastReconciliationDurationMs: latestAttempt.durationMs,
			})
			.from(repositoryExternalSources)
			.leftJoin(
				gitHubInstallations,
				eq(gitHubInstallations.id, repositoryExternalSources.installationId)
			)
			// Each aggregate is scoped to this repository already, so it contributes
			// exactly one row and needs no join condition of its own.
			.leftJoin(deliveries, sql`true`)
			.leftJoin(attemptWindow, sql`true`)
			.leftJoin(latestAttempt, sql`true`)
			// Only a repository GitHub currently drives has synchronization health.
			// An imported snapshot and a repository that has already cut over both
			// keep their source row, and neither is being reconciled any more.
			.where(
				and(
					eq(repositoryExternalSources.repositoryId, repositoryId),
					eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
				)
			)
			.limit(1)

		if (!facts) return undefined

		return {
			syncStatus: facts.syncStatus,
			lastSyncSucceededAt: facts.lastSyncSucceededAt ?? undefined,
			syncFailureCode: facts.syncFailureCode ?? undefined,
			syncFailureReason: facts.syncFailureReason ?? undefined,
			rateLimitedUntil: facts.rateLimitedUntil ?? undefined,
			pendingDeliveryCount: facts.pendingDeliveryCount ?? 0,
			oldestPendingDeliveryAt: facts.oldestPendingDeliveryAt ?? undefined,
			retryCount24h: facts.retryCount24h ?? 0,
			terminalCount24h: facts.terminalCount24h ?? 0,
			completedCount24h: facts.completedCount24h ?? 0,
			latestAttemptStatus: facts.latestAttemptStatus ?? undefined,
			lastReconciliationDurationMs:
				facts.lastReconciliationDurationMs ?? undefined,
		}
	}
}

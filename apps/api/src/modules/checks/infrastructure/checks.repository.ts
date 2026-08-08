import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { CheckKind, CheckState } from '@repo/contracts'
import {
	and,
	checkObservations,
	checks,
	type DrizzleTransaction,
	desc,
	eq,
	type GitHubCheckRunMappingId,
	type GitHubCommitStatusMappingId,
	gitHubActors,
	gitHubCheckRunMappings,
	gitHubCommitStatusMappings,
	inArray,
	type NewCheckObservation,
	sql,
} from '@repo/db'
import type { CheckId, CheckObservationId, RepositoryId } from '@repo/domain'

interface ListEffectiveChecksParams {
	repositoryId: RepositoryId
	shas: string[]
}

interface CheckStreamParams {
	repositoryId: RepositoryId
	sha: string
	context: string
}

/**
 * The newest observation of the newest check competing for a context on one
 * commit, with the provider identity that reported it.
 */
export interface EffectiveCheckRow {
	id: CheckId
	sha: string
	kind: CheckKind
	context: string
	state: CheckState
	rawStatus: string | null
	rawConclusion: string | null
	targetUrl: string | null
	description: string | null
	outputTitle: string | null
	outputSummary: string | null
	startedAt: Date | null
	completedAt: Date | null
	observedAt: Date
	/** Present exactly when GitHub reported the result, whoever it names as actor. */
	runMappingId: GitHubCheckRunMappingId | null
	statusMappingId: GitHubCommitStatusMappingId | null
	runName: string | null
	runDetailsUrl: string | null
	runHtmlUrl: string | null
	appExternalNumericId: bigint | null
	appExternalNodeId: string | null
	appName: string | null
	appSlug: string | null
	appHtmlUrl: string | null
	statusActorLogin: string | null
	statusActorHtmlUrl: string | null
}

type ChecksDatabase = Database | DrizzleTransaction

@Injectable()
export class ChecksRepository {
	constructor(private readonly db: Database) {}

	/**
	 * Effective results for a set of commits in one query.
	 *
	 * Two rounds of narrowing. First the newest page of every check's logbook,
	 * read in the ledger's own append order rather than by provider timestamps: a
	 * requeued run reports no start or completion time at all, so those dates rank
	 * nothing reliably.
	 *
	 * Then the newest check of every `(kind, context)` stream, ranked by the run
	 * identity GitHub itself assigns — run IDs only ever increase, so a rerun
	 * supersedes the run it replaced whichever order the two were imported in.
	 * Commit statuses share one check per context and rank nothing here. Every
	 * tiebreak is a monotonic sequence rather than a random row ID, so two runs
	 * that are otherwise indistinguishable still resolve the same way on every
	 * read.
	 */
	async listEffectiveChecks({
		repositoryId,
		shas,
	}: ListEffectiveChecksParams): Promise<EffectiveCheckRow[]> {
		if (shas.length === 0) return []

		const latestObservations = this.db.$with('latest_observations').as(
			this.db
				.selectDistinctOn([checkObservations.checkId], {
					id: checks.id,
					sha: checks.sha,
					kind: checks.kind,
					context: checks.context,
					// Both tables carry an `id` and the check carries the only
					// `created_at`; inside the CTE they need names of their own or the
					// outer query silently reads the wrong column.
					checkCreatedAt: sql<Date>`${checks.createdAt}`.as('check_created_at'),
					observationId: sql<CheckObservationId>`${checkObservations.id}`.as(
						'observation_id'
					),
					sequence: checkObservations.sequence,
					state: checkObservations.state,
					rawStatus: checkObservations.rawStatus,
					rawConclusion: checkObservations.rawConclusion,
					targetUrl: checkObservations.targetUrl,
					description: checkObservations.description,
					outputTitle: checkObservations.outputTitle,
					outputSummary: checkObservations.outputSummary,
					startedAt: checkObservations.startedAt,
					completedAt: checkObservations.completedAt,
					observedAt: checkObservations.observedAt,
				})
				.from(checkObservations)
				.innerJoin(checks, eq(checks.id, checkObservations.checkId))
				.where(
					and(eq(checks.repositoryId, repositoryId), inArray(checks.sha, shas))
				)
				.orderBy(
					checkObservations.checkId,
					desc(checkObservations.observedAt),
					desc(checkObservations.sequence)
				)
		)

		return await this.db
			.with(latestObservations)
			.selectDistinctOn(
				[
					latestObservations.sha,
					latestObservations.kind,
					latestObservations.context,
				],
				{
					id: latestObservations.id,
					sha: latestObservations.sha,
					kind: latestObservations.kind,
					context: latestObservations.context,
					state: latestObservations.state,
					rawStatus: latestObservations.rawStatus,
					rawConclusion: latestObservations.rawConclusion,
					targetUrl: latestObservations.targetUrl,
					description: latestObservations.description,
					outputTitle: latestObservations.outputTitle,
					outputSummary: latestObservations.outputSummary,
					startedAt: latestObservations.startedAt,
					completedAt: latestObservations.completedAt,
					observedAt: latestObservations.observedAt,
					runMappingId: gitHubCheckRunMappings.id,
					statusMappingId: gitHubCommitStatusMappings.id,
					runName: gitHubCheckRunMappings.name,
					runDetailsUrl: gitHubCheckRunMappings.detailsUrl,
					runHtmlUrl: gitHubCheckRunMappings.htmlUrl,
					appExternalNumericId: gitHubCheckRunMappings.appExternalNumericId,
					appExternalNodeId: gitHubCheckRunMappings.appExternalNodeId,
					appName: gitHubCheckRunMappings.appName,
					appSlug: gitHubCheckRunMappings.appSlug,
					appHtmlUrl: gitHubCheckRunMappings.appHtmlUrl,
					statusActorLogin: gitHubActors.login,
					statusActorHtmlUrl: gitHubActors.htmlUrl,
				}
			)
			.from(latestObservations)
			.leftJoin(
				gitHubCheckRunMappings,
				eq(gitHubCheckRunMappings.checkId, latestObservations.id)
			)
			.leftJoin(
				gitHubCommitStatusMappings,
				eq(
					gitHubCommitStatusMappings.checkObservationId,
					latestObservations.observationId
				)
			)
			.leftJoin(
				gitHubActors,
				eq(gitHubActors.id, gitHubCommitStatusMappings.creatorActorId)
			)
			.orderBy(
				latestObservations.sha,
				latestObservations.kind,
				latestObservations.context,
				sql`${gitHubCheckRunMappings.externalNumericId} desc nulls last`,
				desc(latestObservations.observedAt),
				desc(latestObservations.checkCreatedAt),
				desc(latestObservations.sequence)
			)
	}

	/**
	 * The single stream every commit status posted against a context joins. The
	 * partial unique index makes the concurrent case a no-op rather than a second
	 * stream.
	 */
	async ensureStatusCheck(
		{ context, repositoryId, sha }: CheckStreamParams,
		db: ChecksDatabase = this.db
	): Promise<CheckId> {
		const [inserted] = await db
			.insert(checks)
			.values({ repositoryId, sha, context, kind: 'status' })
			.onConflictDoNothing()
			.returning({ id: checks.id })

		if (inserted) return inserted.id

		const [existing] = await db
			.select({ id: checks.id })
			.from(checks)
			.where(
				and(
					eq(checks.repositoryId, repositoryId),
					eq(checks.sha, sha),
					eq(checks.context, context),
					eq(checks.kind, 'status')
				)
			)
			.limit(1)

		if (!existing)
			throw new Error(
				`commit status stream ${context} on ${sha} could not be resolved`
			)

		return existing.id
	}

	/**
	 * A logical check for one provider run identity. A rerun that GitHub reports
	 * under a new run ID gets its own row and competes for the context; the run it
	 * replaced stays readable.
	 */
	async createCheckRun(
		{ context, repositoryId, sha }: CheckStreamParams,
		db: ChecksDatabase = this.db
	): Promise<CheckId> {
		const [created] = await db
			.insert(checks)
			.values({ repositoryId, sha, context, kind: 'check_run' })
			.returning({ id: checks.id })

		if (!created)
			throw new Error(`check run ${context} on ${sha} could not be created`)

		return created.id
	}

	/**
	 * Appends a page to a check's logbook. Returns nothing when the fingerprint is
	 * already on file, which is how a replayed snapshot stays a no-op.
	 */
	async appendObservation(
		observation: NewCheckObservation,
		db: ChecksDatabase = this.db
	): Promise<CheckObservationId | undefined> {
		const [appended] = await db
			.insert(checkObservations)
			.values(observation)
			.onConflictDoNothing({
				target: [checkObservations.checkId, checkObservations.fingerprint],
			})
			.returning({ id: checkObservations.id })

		return appended?.id
	}
}

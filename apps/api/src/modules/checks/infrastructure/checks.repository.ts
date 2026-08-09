import { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { CheckKind, CheckState } from '@repo/contracts'
import {
	and,
	checkObservations,
	checkStatusProviders,
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
	isNull,
	type NewCheckObservation,
	sql,
} from '@repo/db'
import type {
	CheckId,
	CheckObservationId,
	CheckStatusProviderId,
	RepositoryId,
} from '@repo/domain'

interface ListEffectiveChecksParams {
	repositoryId: RepositoryId
	shas: string[]
}

interface CheckStreamParams {
	repositoryId: RepositoryId
	sha: string
	context: string
}

interface StatusCheckStreamParams extends CheckStreamParams {
	/** Absent is the imported stream; a provider gets a stream of its own. */
	providerId?: CheckStatusProviderId
}

interface PublishStatusObservationParams extends StatusCheckStreamParams {
	observation: Omit<NewCheckObservation, 'checkId' | 'repositoryId'>
}

/**
 * `duplicate` means the fingerprint was already on file. Both pages come back:
 * the one that key recorded, to compare the submission against, and the newest
 * one, which is what the commit actually carries now.
 */
export type PublishStatusObservationResult =
	| { status: 'appended'; checkId: CheckId }
	| {
			status: 'duplicate'
			checkId: CheckId
			recorded?: CheckObservationRow
			effective?: CheckObservationRow
	  }

interface ObservationFingerprintParams {
	checkId: CheckId
	fingerprint: string
}

/**
 * A page of a check's logbook read back by the key its writer chose for it,
 * carrying everything a repeat submission has to be compared against.
 */
export interface CheckObservationRow {
	id: CheckObservationId
	state: CheckState
	targetUrl: string | null
	description: string | null
	providerCreatedAt: Date | null
	observedAt: Date
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
	/** Present exactly when a registered provider published the result natively. */
	providerId: CheckStatusProviderId | null
	providerKey: string | null
	providerDisplayName: string | null
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

const OBSERVATION_COLUMNS = {
	id: checkObservations.id,
	state: checkObservations.state,
	targetUrl: checkObservations.targetUrl,
	description: checkObservations.description,
	providerCreatedAt: checkObservations.providerCreatedAt,
	observedAt: checkObservations.observedAt,
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
	 * Then the newest check of every `(kind, context, provider)` stream, ranked by
	 * the run identity GitHub itself assigns — run IDs only ever increase, so a
	 * rerun supersedes the run it replaced whichever order the two were imported
	 * in. Commit statuses share one check per context and rank nothing here. Every
	 * tiebreak is a monotonic sequence rather than a random row ID, so two runs
	 * that are otherwise indistinguishable still resolve the same way on every
	 * read.
	 *
	 * The provider is part of the partition because two systems reporting the same
	 * context are two answers, not one contested one. Everything imported shares
	 * the absent provider and therefore keeps collapsing into a single stream per
	 * context exactly as it always has.
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
					providerId: checks.providerId,
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
					latestObservations.providerId,
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
					providerId: latestObservations.providerId,
					providerKey: checkStatusProviders.key,
					providerDisplayName: checkStatusProviders.displayName,
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
				checkStatusProviders,
				eq(checkStatusProviders.id, latestObservations.providerId)
			)
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
				latestObservations.providerId,
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
		{ context, providerId, repositoryId, sha }: StatusCheckStreamParams,
		db: ChecksDatabase = this.db
	): Promise<CheckId> {
		const [inserted] = await db
			.insert(checks)
			.values({ repositoryId, sha, context, kind: 'status', providerId })
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
					eq(checks.kind, 'status'),
					// The imported stream is the one whose provider is absent, and
					// `= null` matches nothing, so the two cases need different SQL.
					providerId
						? eq(checks.providerId, providerId)
						: isNull(checks.providerId)
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

	/**
	 * One external report, written under a single fence.
	 *
	 * Resolving the stream, appending to it, and reading back what the stream now
	 * says are one decision, not three: outside a transaction another publisher
	 * could interleave between them and this caller would answer with a state
	 * that was never true at any single moment. Whether a duplicate is a replay
	 * or a conflict is the caller's to judge, so both pages are handed back
	 * rather than compared here.
	 */
	async publishStatusObservation({
		context,
		observation,
		providerId,
		repositoryId,
		sha,
	}: PublishStatusObservationParams): Promise<PublishStatusObservationResult> {
		return await this.db.transaction(async tx => {
			const checkId = await this.ensureStatusCheck(
				{ repositoryId, sha, context, providerId },
				tx
			)
			const appended = await this.appendObservation(
				{ ...observation, repositoryId, checkId },
				tx
			)

			if (appended) return { status: 'appended', checkId }

			// Sequential rather than raced: a transaction is one connection, so
			// there is nothing to win by overlapping them.
			const recorded = await this.findObservationByFingerprint(
				{ checkId, fingerprint: observation.fingerprint },
				tx
			)
			const effective = await this.findLatestObservation(checkId, tx)

			return { status: 'duplicate', checkId, recorded, effective }
		})
	}

	/**
	 * The newest page of one check's logbook, in the ledger's own append order —
	 * the same order, down to the tiebreak, that decides the effective result on
	 * every read.
	 */
	async findLatestObservation(
		checkId: CheckId,
		db: ChecksDatabase = this.db
	): Promise<CheckObservationRow | undefined> {
		const [observation] = await db
			.select(OBSERVATION_COLUMNS)
			.from(checkObservations)
			.where(eq(checkObservations.checkId, checkId))
			.orderBy(
				desc(checkObservations.observedAt),
				desc(checkObservations.sequence)
			)
			.limit(1)

		return observation
	}

	/**
	 * The page a writer already filed under one key. A native publisher's key is
	 * its own, so this is how a repeat submission is compared against what that
	 * key actually recorded rather than assumed to be a duplicate of it.
	 */
	async findObservationByFingerprint(
		{ checkId, fingerprint }: ObservationFingerprintParams,
		db: ChecksDatabase = this.db
	): Promise<CheckObservationRow | undefined> {
		const [observation] = await db
			.select(OBSERVATION_COLUMNS)
			.from(checkObservations)
			.where(
				and(
					eq(checkObservations.checkId, checkId),
					eq(checkObservations.fingerprint, fingerprint)
				)
			)
			.limit(1)

		return observation
	}
}

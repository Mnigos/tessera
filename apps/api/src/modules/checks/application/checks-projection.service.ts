import type { Database } from '@config/database'
import { Injectable } from '@nestjs/common'
import type { CheckKind } from '@repo/contracts'
import type { DrizzleTransaction, NewCheckObservation } from '@repo/db'
import type { CheckId, CheckObservationId, RepositoryId } from '@repo/domain'
import { ChecksRepository } from '../infrastructure/checks.repository'

interface ResolveCheckParams {
	repositoryId: RepositoryId
	sha: string
	kind: CheckKind
	context: string
	/** The check an earlier projection already created for this run identity. */
	existingCheckId?: CheckId
}

type ChecksDatabase = Database | DrizzleTransaction

/**
 * The seam a projection writes native checks through.
 *
 * Provider identity stays in the importing module's mapping tables and the
 * native aggregate stays behind this service, so no synchronizer reaches into
 * `checks` or `check_observations` directly. Both methods take the caller's
 * transaction: a projection appends inside the fence it already holds.
 */
@Injectable()
export class ChecksProjectionService {
	constructor(private readonly checksRepository: ChecksRepository) {}

	/**
	 * The check a provider result belongs to. Every commit status against a
	 * context joins one stream; a check run keeps a row per run identity, so a
	 * rerun GitHub reports under a new ID becomes a new check that competes with
	 * the one it replaced instead of overwriting it.
	 */
	async resolveCheck(
		{ context, existingCheckId, kind, repositoryId, sha }: ResolveCheckParams,
		db?: ChecksDatabase
	): Promise<CheckId> {
		if (existingCheckId) return existingCheckId

		if (kind === 'status')
			return await this.checksRepository.ensureStatusCheck(
				{ repositoryId, sha, context },
				db
			)

		return await this.checksRepository.createCheckRun(
			{ repositoryId, sha, context },
			db
		)
	}

	/**
	 * Appends a result to a check's logbook. Returns nothing when the same report
	 * is already on file, which is what makes a replayed snapshot a no-op.
	 */
	async appendObservation(
		observation: NewCheckObservation,
		db?: ChecksDatabase
	): Promise<CheckObservationId | undefined> {
		return await this.checksRepository.appendObservation(observation, db)
	}
}

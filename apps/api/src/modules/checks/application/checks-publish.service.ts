import { Injectable } from '@nestjs/common'
import type {
	ParsedPublishCommitStatusInput,
	PublishableCheckState,
	PublishCommitStatusOutput,
} from '@repo/contracts'
import { CheckStatusIdempotencyConflictError } from '../domain/check-status.errors'
import type { CheckStatusCredentialAuthorization } from '../domain/check-status-authorization'
import {
	type CheckObservationRow,
	ChecksRepository,
} from '../infrastructure/checks.repository'

/**
 * Content can never key a published report: `pending → success → pending` is
 * three genuine reports and two of them hash alike. The caller's key is the
 * identity, namespaced so it cannot collide with an imported fingerprint.
 */
function toPublishedFingerprint(idempotencyKey: string): string {
	return `published:${idempotencyKey}`
}

@Injectable()
export class ChecksPublishService {
	constructor(private readonly checksRepository: ChecksRepository) {}

	/**
	 * Records one external report and answers with the state the commit now
	 * carries for that context.
	 *
	 * The provider comes from the credential the guard verified, never from the
	 * request, so a publisher can only ever speak in its own name.
	 */
	async publishStatus(
		{
			credentialId,
			providerId,
			repositoryId,
		}: CheckStatusCredentialAuthorization,
		{
			context,
			description,
			idempotencyKey,
			reportedAt,
			sha,
			state,
			targetUrl,
		}: ParsedPublishCommitStatusInput
	): Promise<PublishCommitStatusOutput> {
		const fingerprint = toPublishedFingerprint(idempotencyKey)
		const observedAt = new Date()
		const written = await this.checksRepository.publishStatusObservation({
			repositoryId,
			sha,
			context,
			providerId,
			observation: {
				state,
				targetUrl,
				description,
				credentialId,
				providerCreatedAt: reportedAt,
				observedAt,
				fingerprint,
			},
		})

		if (written.status === 'appended')
			return {
				checkId: written.checkId,
				sha,
				context,
				state,
				observedAt,
				created: true,
			}

		// The key conflicted a moment ago and its page is gone now, which nothing
		// in an append-only ledger can do. Treating that as a duplicate would
		// silently drop the report, so it is reported as the conflict it is.
		if (!(written.recorded && written.effective))
			throw new CheckStatusIdempotencyConflictError({
				context,
				idempotencyKey,
				sha,
			})

		if (
			!matchesRecordedReport(written.recorded, {
				description,
				reportedAt,
				state,
				targetUrl,
			})
		)
			throw new CheckStatusIdempotencyConflictError({
				context,
				idempotencyKey,
				recordedState: written.recorded.state,
				sha,
			})

		// The answer is what the commit now carries for this context, not what this
		// key recorded. A retry of an older key would otherwise tell CI that a
		// context it has since moved past had un-succeeded.
		return {
			checkId: written.checkId,
			sha,
			context,
			state: written.effective.state,
			observedAt: written.effective.observedAt,
			created: false,
		}
	}
}

/**
 * Every field the caller supplied counts: a retry that changed any of them is
 * asking for a different row than the one on file, and answering it with
 * success would claim a write that never happened.
 */
function matchesRecordedReport(
	recorded: CheckObservationRow,
	submitted: {
		description?: string
		reportedAt?: Date
		state: PublishableCheckState
		targetUrl?: string
	}
): boolean {
	return (
		recorded.state === submitted.state &&
		(recorded.targetUrl ?? undefined) === submitted.targetUrl &&
		(recorded.description ?? undefined) === submitted.description &&
		recorded.providerCreatedAt?.getTime() === submitted.reportedAt?.getTime()
	)
}

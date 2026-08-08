import { createHash } from 'node:crypto'
import type { RepositoryId } from '@repo/domain'
import type {
	GitHubSyncCheckRun,
	GitHubSyncCommitStatus,
} from '../infrastructure/github-sync.client.types'

/**
 * Check output summaries are provider-authored markdown that GitHub accepts up
 * to 65535 characters of. The panel renders a few lines, so the ledger keeps a
 * readable excerpt rather than the whole report on every observation.
 */
const CHECK_OUTPUT_SUMMARY_LIMIT = 4000

export function boundCheckOutputSummary(summary?: string): string | undefined {
	if (!summary) return undefined

	return summary.length > CHECK_OUTPUT_SUMMARY_LIMIT
		? summary.slice(0, CHECK_OUTPUT_SUMMARY_LIMIT)
		: summary
}

/**
 * The content identity of one report about a check run: the run it belongs to
 * plus everything a rerun or a lifecycle transition would change. A snapshot
 * replayed unchanged produces the same fingerprint and appends nothing.
 *
 * It hashes the excerpt that actually gets stored, not the provider's full
 * summary. Hashing more than the ledger keeps would make two reports Tessera
 * records identically look different, appending a page whose every visible
 * field repeats the one before it.
 */
export function toCheckRunFingerprint(run: GitHubSyncCheckRun): string {
	return `run:${hashParts([
		run.nodeId,
		run.status,
		run.conclusion,
		run.startedAt?.toISOString(),
		run.completedAt?.toISOString(),
		run.detailsUrl,
		run.htmlUrl,
		run.outputTitle,
		boundCheckOutputSummary(run.outputSummary),
	])}`
}

/**
 * A context's statuses in the order they were posted.
 *
 * GitHub lists them newest first, and the effective-result query reads the
 * ledger's own append order — so replaying a stream as it arrives would leave
 * the oldest post looking like the newest. Statuses are immutable and their IDs
 * only increase, which settles two posted in the same second.
 */
export function sortCommitStatusesChronologically(
	statuses: GitHubSyncCommitStatus[]
): GitHubSyncCommitStatus[] {
	return [...statuses].sort(
		(left, right) =>
			left.createdAt.getTime() - right.createdAt.getTime() ||
			Number(left.numericId - right.numericId)
	)
}

/**
 * A posted commit status is immutable, so its own stable ID is the whole
 * identity. The synthetic hash is a fallback for a provider that reported no
 * ID at all, never the normal key.
 */
export function toCommitStatusFingerprint({
	repositoryId,
	sha,
	status,
}: {
	repositoryId: RepositoryId
	sha: string
	status: GitHubSyncCommitStatus
}): string {
	if (status.nodeId) return `status:${status.nodeId}`
	if (status.numericId) return `status:${status.numericId}`

	return `status-legacy:${hashParts([
		repositoryId,
		sha,
		status.context,
		status.createdAt.toISOString(),
		status.state,
		status.targetUrl,
	])}`
}

// The separator is a byte no provider value can contain, so a shifted field
// boundary cannot make two different reports hash the same.
function hashParts(parts: (string | undefined)[]): string {
	return createHash('sha256')
		.update(parts.map(part => part ?? '').join('\u0000'))
		.digest('hex')
}

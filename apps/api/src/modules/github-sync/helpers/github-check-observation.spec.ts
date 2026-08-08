import type { RepositoryId } from '@repo/domain'
import type {
	GitHubSyncCheckRun,
	GitHubSyncCommitStatus,
} from '../infrastructure/github-sync.client.types'
import {
	boundCheckOutputSummary,
	sortCommitStatusesChronologically,
	toCheckRunFingerprint,
	toCommitStatusFingerprint,
} from './github-check-observation'

const repositoryId = '00000000-0000-4000-8000-000000000001' as RepositoryId
const LEGACY_STATUS_FINGERPRINT_REGEX = /^status-legacy:/

describe('GitHub check observations', () => {
	test('bounds stored output without changing short output', () => {
		expect(boundCheckOutputSummary('short')).toBe('short')
		expect(boundCheckOutputSummary('x'.repeat(4001))).toHaveLength(4000)
		expect(boundCheckOutputSummary(undefined)).toBeUndefined()
	})

	test('never cuts an emoji in half at the boundary', () => {
		// PostgreSQL rejects a lone surrogate, so an orphaned half would fail the
		// whole projection transaction rather than just truncating this summary.
		const excerpt = boundCheckOutputSummary(`${'x'.repeat(3999)}😀tail`)

		expect(excerpt).toHaveLength(3999)
		expect(excerpt?.isWellFormed()).toBeTruthy()
		// A pair that fits whole is kept whole.
		expect(boundCheckOutputSummary(`${'x'.repeat(3998)}😀tail`)).toHaveLength(
			4000
		)
	})

	test('fingerprints the complete mutable check-run snapshot', () => {
		const run = checkRun()

		expect(toCheckRunFingerprint(run)).toBe(toCheckRunFingerprint({ ...run }))
		expect(toCheckRunFingerprint(run)).not.toBe(
			toCheckRunFingerprint({ ...run, status: 'completed' })
		)
		expect(toCheckRunFingerprint(run)).not.toBe(
			toCheckRunFingerprint({ ...run, outputSummary: 'changed' })
		)
	})

	test('fingerprints the summary it stores rather than the one it was sent', () => {
		const run = { ...checkRun(), outputSummary: 'x'.repeat(4000) }

		// Two reports Tessera records identically must not append two pages whose
		// every visible field is the same.
		expect(toCheckRunFingerprint(run)).toBe(
			toCheckRunFingerprint({
				...run,
				outputSummary: `${'x'.repeat(4000)}tail`,
			})
		)
	})

	test('replays a status stream oldest first, settling ties by provider ID', () => {
		const base = commitStatus()
		const newest = {
			...base,
			nodeId: 'newest',
			numericId: 9n,
			createdAt: new Date('2026-08-08T12:00:00Z'),
		}
		const sameSecond = { ...base, nodeId: 'same-second', numericId: 5n }

		expect(
			sortCommitStatusesChronologically([newest, sameSecond, base]).map(
				status => status.nodeId
			)
		).toEqual(['status-node', 'same-second', 'newest'])
	})

	test('uses stable status identity and only falls back when IDs are absent', () => {
		const status = commitStatus()

		expect(
			toCommitStatusFingerprint({ repositoryId, sha: 'head', status })
		).toBe('status:status-node')
		expect(
			toCommitStatusFingerprint({
				repositoryId,
				sha: 'head',
				status: { ...status, nodeId: '', numericId: 42n },
			})
		).toBe('status:42')
		expect(
			toCommitStatusFingerprint({
				repositoryId,
				sha: 'head',
				status: { ...status, nodeId: '', numericId: 0n },
			})
		).toMatch(LEGACY_STATUS_FINGERPRINT_REGEX)
	})
})

function checkRun(): GitHubSyncCheckRun {
	return {
		nodeId: 'run-node',
		numericId: 1n,
		name: 'build',
		headSha: 'head',
		status: 'queued',
		startedAt: new Date('2026-08-08T10:00:00Z'),
		outputSummary: 'summary',
	}
}

function commitStatus(): GitHubSyncCommitStatus {
	return {
		nodeId: 'status-node',
		numericId: 2n,
		context: 'ci',
		state: 'success',
		createdAt: new Date('2026-08-08T10:00:00Z'),
		updatedAt: new Date('2026-08-08T10:00:00Z'),
	}
}

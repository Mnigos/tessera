import type {
	GitHubCheckRunMappingId,
	GitHubCommitStatusMappingId,
} from '@repo/db'
import type { CheckId } from '@repo/domain'
import type { EffectiveCheckRow } from '../infrastructure/checks.repository'
import { toCheckOutput } from './check-output'

describe('check output', () => {
	test('keeps web links a reader can safely follow', () => {
		expect(
			toCheckOutput(row({ targetUrl: 'https://ci.example.com/runs/1' }))
				.targetUrl
		).toBe('https://ci.example.com/runs/1')
		expect(
			toCheckOutput(row({ targetUrl: 'http://ci.example.com/runs/1' }))
				.targetUrl
		).toBe('http://ci.example.com/runs/1')
	})

	test('drops a script or inline-payload link a provider claimed as its page', () => {
		// These parse as URLs, so parseability alone would render them as anchors
		// the reader clicks under Tessera's own origin.
		expect(
			toCheckOutput(row({ targetUrl: 'javascript:alert(1)' })).targetUrl
		).toBeUndefined()
		expect(
			toCheckOutput(
				row({ targetUrl: 'data:text/html,<script>alert(1)</script>' })
			).targetUrl
		).toBeUndefined()
		expect(
			toCheckOutput(row({ targetUrl: 'file:///etc/passwd' })).targetUrl
		).toBeUndefined()
		expect(
			toCheckOutput(row({ targetUrl: 'not a url' })).targetUrl
		).toBeUndefined()
	})

	test('falls back past an unusable link rather than reporting no page at all', () => {
		expect(
			toCheckOutput(
				row({
					targetUrl: 'javascript:alert(1)',
					runDetailsUrl: 'https://ci.example.com/details',
				})
			).targetUrl
		).toBe('https://ci.example.com/details')
	})

	test('drops a provider profile link that is not a web address', () => {
		expect(
			toCheckOutput(row({ appHtmlUrl: 'javascript:alert(1)' })).provider.url
		).toBeUndefined()
		expect(
			toCheckOutput(row({ appHtmlUrl: 'https://github.com/apps/ci' })).provider
				.url
		).toBe('https://github.com/apps/ci')
	})
})

function row(overrides: Partial<EffectiveCheckRow> = {}): EffectiveCheckRow {
	return {
		id: crypto.randomUUID() as CheckId,
		sha: 'head',
		kind: 'check_run',
		context: 'ci',
		state: 'success',
		rawStatus: null,
		rawConclusion: null,
		targetUrl: null,
		description: null,
		outputTitle: null,
		outputSummary: null,
		startedAt: null,
		completedAt: null,
		observedAt: new Date('2026-08-08T10:00:00Z'),
		runMappingId: crypto.randomUUID() as GitHubCheckRunMappingId,
		statusMappingId: null as GitHubCommitStatusMappingId | null,
		runName: 'ci',
		runDetailsUrl: null,
		runHtmlUrl: null,
		appExternalNumericId: null,
		appExternalNodeId: null,
		appName: null,
		appSlug: null,
		appHtmlUrl: null,
		statusActorLogin: null,
		statusActorHtmlUrl: null,
		...overrides,
	}
}

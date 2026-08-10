import { z } from 'zod'
import { ExternalServiceError } from '~/shared/errors'
import {
	classifyGitHubSyncFailure,
	readGitHubSyncFailure,
	toGitHubSyncFailureReason,
} from './github-sync-failure'

function requestError(
	status: number,
	headers: Record<string, string> = {}
): Error & { status: number; response: { headers: Record<string, string> } } {
	return Object.assign(new Error('provider said no'), {
		status,
		response: { headers },
	})
}

describe('classifyGitHubSyncFailure', () => {
	test('reads an unreachable GitHub as transport', () => {
		expect(classifyGitHubSyncFailure(new Error('socket hang up'))).toEqual({
			failureClass: 'transport',
			failureCode: 'upstream_unavailable',
			scope: undefined,
			statusCode: undefined,
			requestId: undefined,
			rateLimitRemaining: undefined,
		})
	})

	test.each([
		408, 500, 502, 503,
	])('retries an upstream failure reported as %i', status => {
		expect(classifyGitHubSyncFailure(requestError(status))).toMatchObject({
			failureClass: 'transport',
			failureCode: 'upstream_unavailable',
			statusCode: status,
		})
	})

	test('reads an exhausted budget as a rate limit rather than a refusal', () => {
		expect(
			classifyGitHubSyncFailure(
				requestError(403, {
					'x-ratelimit-remaining': '0',
					'x-ratelimit-reset': '1780000000',
				})
			)
		).toMatchObject({
			failureClass: 'rate_limit',
			failureCode: 'rate_limited',
			rateLimitRemaining: 0,
			retryAt: new Date(1_780_000_000_000),
		})
	})

	test('reads a secondary limit from retry-after while the budget is intact', () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-08-11T10:00:00Z'))

		expect(
			classifyGitHubSyncFailure(
				requestError(403, {
					'retry-after': '60',
					'x-ratelimit-remaining': '4200',
				})
			)
		).toMatchObject({
			failureClass: 'rate_limit',
			rateLimitRemaining: 4200,
			retryAt: new Date('2026-08-11T10:01:00Z'),
		})

		vi.useRealTimers()
	})

	test('reads 429 as a rate limit without any headers', () => {
		expect(classifyGitHubSyncFailure(requestError(429))).toMatchObject({
			failureClass: 'rate_limit',
			failureCode: 'rate_limited',
		})
	})

	test('blocks on a refusal that is not a limit', () => {
		expect(classifyGitHubSyncFailure(requestError(403))).toMatchObject({
			failureClass: 'authentication',
			failureCode: 'authorization_failed',
		})
	})

	test('blocks on a rejected credential', () => {
		expect(
			classifyGitHubSyncFailure(requestError(401), 'installation_token')
		).toMatchObject({
			failureClass: 'authentication',
			failureCode: 'authentication_failed',
		})
	})

	test('treats a missing repository as lost access rather than a missing resource', () => {
		expect(
			classifyGitHubSyncFailure(requestError(404), 'repository')
		).toMatchObject({
			failureClass: 'authentication',
			failureCode: 'repository_unavailable',
		})
	})

	test('treats a missing installation as lost access', () => {
		expect(
			classifyGitHubSyncFailure(requestError(404), 'installation_token')
		).toMatchObject({
			failureClass: 'authentication',
			failureCode: 'repository_unavailable',
		})
	})

	test.each([
		'ref',
		'suite',
	] as const)('settles a %s that GitHub no longer has', scope => {
		expect(classifyGitHubSyncFailure(requestError(404), scope)).toMatchObject({
			failureClass: 'permanent_not_found',
			failureCode: 'resource_not_found',
			scope,
		})
	})

	test('terminalizes a payload that disagrees with the schema, keeping only paths', () => {
		const parsed = z
			.object({ pull_request: z.object({ number: z.number() }) })
			.safeParse({ pull_request: { number: 'sensitive-value' } })

		expect(classifyGitHubSyncFailure(parsed.error)).toMatchObject({
			failureClass: 'validation',
			failureCode: 'provider_schema_mismatch',
			issuePaths: ['pull_request.number'],
		})
	})

	test('terminalizes a request GitHub rejected', () => {
		expect(classifyGitHubSyncFailure(requestError(422))).toMatchObject({
			failureClass: 'validation',
			failureCode: 'provider_rejected_request',
		})
	})

	test('keeps only allowlisted diagnostics out of a rich provider error', () => {
		const failure = classifyGitHubSyncFailure(
			requestError(500, {
				authorization: 'Bearer ghs_secret-token',
				'set-cookie': 'session=secret',
				'x-github-request-id': 'ABCD:1234',
			}),
			'repository'
		)

		expect(Object.keys(failure).toSorted()).toEqual([
			'failureClass',
			'failureCode',
			'rateLimitRemaining',
			'requestId',
			'scope',
			'statusCode',
		])
		expect(failure.requestId).toBe('ABCD:1234')
		expect(JSON.stringify(failure)).not.toContain('ghs_secret-token')
	})
})

describe('readGitHubSyncFailure', () => {
	test('reads back a classification the client already made', () => {
		expect(
			readGitHubSyncFailure(
				new ExternalServiceError('github', {
					failureClass: 'rate_limit',
					failureCode: 'rate_limited',
					scope: 'repository',
					statusCode: 403,
					retryAt: new Date('2026-08-11T10:01:00Z'),
					rateLimitRemaining: 0,
				})
			)
		).toEqual({
			failureClass: 'rate_limit',
			failureCode: 'rate_limited',
			scope: 'repository',
			statusCode: 403,
			requestId: undefined,
			retryAt: new Date('2026-08-11T10:01:00Z'),
			rateLimitRemaining: 0,
		})
	})

	test('classifies an error that carries only a status and a scope', () => {
		expect(
			readGitHubSyncFailure(
				new ExternalServiceError('github', { scope: 'ref', statusCode: 404 })
			)
		).toMatchObject({
			failureClass: 'permanent_not_found',
			failureCode: 'resource_not_found',
		})
	})

	test('leaves a failure that never reached GitHub retryable', () => {
		expect(
			readGitHubSyncFailure(
				new ExternalServiceError('git storage', { grpcCode: 14 })
			)
		).toEqual({
			failureClass: 'unknown',
			failureCode: 'reconciliation_failed',
		})
	})

	// A code read back off an error is a string somebody else wrote, and it ends
	// up in the database, in logs, and on the failed job.
	test('refuses a failure code outside the closed set', () => {
		expect(
			readGitHubSyncFailure(
				new ExternalServiceError('github', {
					failureClass: 'transport',
					failureCode: 'Bad credentials for ghs_secret-token',
				})
			)
		).toMatchObject({
			failureClass: 'transport',
			failureCode: 'reconciliation_failed',
		})
	})

	test('leaves a plain error retryable', () => {
		expect(readGitHubSyncFailure(new Error('boom'))).toEqual({
			failureClass: 'unknown',
			failureCode: 'reconciliation_failed',
		})
	})
})

describe('toGitHubSyncFailureReason', () => {
	test('keeps the pre-existing wording for an unclassified failure', () => {
		expect(toGitHubSyncFailureReason('unknown')).toBe(
			'GitHub synchronization failed. Check the GitHub App installation and wait for Tessera to retry.'
		)
	})

	test('tells a reader with lost access what to do about it', () => {
		expect(toGitHubSyncFailureReason('authentication')).toContain('Reauthorize')
	})
})

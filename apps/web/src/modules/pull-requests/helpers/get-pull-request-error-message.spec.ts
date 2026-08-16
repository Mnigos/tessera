import { ORPCError } from '@orpc/client'
import {
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_SYNC_DELAYED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
	REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE,
} from '@repo/contracts'
import {
	getPullRequestErrorMessage,
	isGitHubReconnectRequiredError,
} from './get-pull-request-error-message'

const FALLBACK = 'The action could not be completed.'

describe(getPullRequestErrorMessage.name, () => {
	test.each([
		[401, 'UNAUTHORIZED', GITHUB_RECONNECT_REQUIRED_MESSAGE],
		[403, 'FORBIDDEN', GITHUB_WRITE_FORBIDDEN_MESSAGE],
		[403, 'FORBIDDEN', REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE],
		...Object.values(GITHUB_WRITE_REJECTED_MESSAGES).map(
			message => [409, 'CONFLICT', message] as const
		),
		[409, 'CONFLICT', GITHUB_SYNC_DELAYED_MESSAGE],
		[429, 'TOO_MANY_REQUESTS', GITHUB_RATE_LIMITED_MESSAGE],
		[502, 'BAD_GATEWAY', GITHUB_UNAVAILABLE_MESSAGE],
	] as const)('surfaces explained copy at status %s', (status, code, message) => {
		expect(
			getPullRequestErrorMessage(
				new ORPCError(code, { status, message }),
				FALLBACK
			)
		).toBe(message)
	})

	test('falls back for unknown server copy', () => {
		expect(
			getPullRequestErrorMessage(
				new ORPCError('INTERNAL_SERVER_ERROR', {
					status: 500,
					message: 'Unexpected server detail',
				}),
				FALLBACK
			)
		).toBe(FALLBACK)
	})

	test.each([
		400, 409,
	] as const)('surfaces unknown client copy at status %s', status => {
		const message = 'The pull request changed.'

		expect(
			getPullRequestErrorMessage(
				new ORPCError(status === 400 ? 'BAD_REQUEST' : 'CONFLICT', {
					status,
					message,
				}),
				FALLBACK
			)
		).toBe(message)
	})

	test('falls back for errors outside the oRPC boundary', () => {
		expect(getPullRequestErrorMessage(new Error('network'), FALLBACK)).toBe(
			FALLBACK
		)
	})
})

describe(isGitHubReconnectRequiredError.name, () => {
	test('matches only the reconnect message', () => {
		expect(
			isGitHubReconnectRequiredError(
				new ORPCError('UNAUTHORIZED', {
					status: 401,
					message: GITHUB_RECONNECT_REQUIRED_MESSAGE,
				})
			)
		).toBeTruthy()
		expect(
			isGitHubReconnectRequiredError(
				new ORPCError('UNAUTHORIZED', {
					status: 401,
					message: 'Sign in again.',
				})
			)
		).toBeFalsy()
		expect(isGitHubReconnectRequiredError(new Error('network'))).toBeFalsy()
	})
})

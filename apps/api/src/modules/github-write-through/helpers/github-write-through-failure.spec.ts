import {
	GITHUB_RATE_LIMITED_MESSAGE,
	GITHUB_RECONNECT_REQUIRED_MESSAGE,
	GITHUB_UNAVAILABLE_MESSAGE,
	GITHUB_WRITE_FORBIDDEN_MESSAGE,
	GITHUB_WRITE_REJECTED_MESSAGES,
} from '@repo/contracts'
import {
	GitHubRateLimitedError,
	GitHubReconnectRequiredError,
	GitHubUnavailableError,
	GitHubWriteForbiddenError,
	GitHubWriteRejectedError,
} from '../domain/github-write-through.errors'
import { toGitHubWriteError } from './github-write-through-failure'

const PROVIDER_DETAIL = 'provider-secret-detail'

function httpError(
	status: number,
	message = PROVIDER_DETAIL,
	headers: Record<string, string | number> = {}
) {
	return Object.assign(new Error(message), {
		status,
		response: {
			headers,
			data: { message: PROVIDER_DETAIL },
		},
	})
}

function graphQLError(type: string) {
	return Object.assign(new Error(PROVIDER_DETAIL), {
		errors: [{ type, message: PROVIDER_DETAIL }],
	})
}

describe(toGitHubWriteError.name, () => {
	test.each([
		[
			'401',
			httpError(401),
			'pull_request',
			GitHubReconnectRequiredError,
			'UNAUTHORIZED',
			GITHUB_RECONNECT_REQUIRED_MESSAGE,
		],
		[
			'403 with retry-after',
			httpError(403, PROVIDER_DETAIL, { 'retry-after': '30' }),
			'pull_request',
			GitHubRateLimitedError,
			'TOO_MANY_REQUESTS',
			GITHUB_RATE_LIMITED_MESSAGE,
		],
		[
			'403 with no remaining budget',
			httpError(403, PROVIDER_DETAIL, { 'x-ratelimit-remaining': 0 }),
			'pull_request',
			GitHubRateLimitedError,
			'TOO_MANY_REQUESTS',
			GITHUB_RATE_LIMITED_MESSAGE,
		],
		[
			'403 credential message',
			httpError(403, 'Bad credentials'),
			'pull_request',
			GitHubReconnectRequiredError,
			'UNAUTHORIZED',
			GITHUB_RECONNECT_REQUIRED_MESSAGE,
		],
		[
			'403 plain',
			httpError(403),
			'pull_request',
			GitHubWriteForbiddenError,
			'FORBIDDEN',
			GITHUB_WRITE_FORBIDDEN_MESSAGE,
		],
		[
			'404',
			httpError(404),
			'pull_request',
			GitHubWriteForbiddenError,
			'FORBIDDEN',
			GITHUB_WRITE_FORBIDDEN_MESSAGE,
		],
		[
			'405 merge',
			httpError(405),
			'merge',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.unmergeable,
		],
		[
			'409 merge',
			httpError(409),
			'merge',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.stale_head,
		],
		[
			'422 own pull request',
			httpError(422, 'Can not approve your own pull request'),
			'review',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.self_approval,
		],
		[
			'422 merge',
			httpError(422),
			'merge',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.unmergeable,
		],
		[
			'422 review stale commit',
			httpError(422, 'Commit abc123 is not part of the pull request'),
			'review',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.stale_head,
		],
		[
			'422 comment',
			httpError(422),
			'comment',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.invalid_anchor,
		],
		[
			'422 line-side detail',
			httpError(422, 'Validation failed for line and side'),
			'review',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.invalid_anchor,
		],
		[
			'422 other action',
			httpError(422),
			'reviewers',
			GitHubWriteForbiddenError,
			'FORBIDDEN',
			GITHUB_WRITE_FORBIDDEN_MESSAGE,
		],
		[
			'429',
			httpError(429),
			'pull_request',
			GitHubRateLimitedError,
			'TOO_MANY_REQUESTS',
			GITHUB_RATE_LIMITED_MESSAGE,
		],
		[
			'500',
			httpError(500),
			'pull_request',
			GitHubUnavailableError,
			'BAD_GATEWAY',
			GITHUB_UNAVAILABLE_MESSAGE,
		],
		[
			'network error',
			new Error(PROVIDER_DETAIL),
			'pull_request',
			GitHubUnavailableError,
			'BAD_GATEWAY',
			GITHUB_UNAVAILABLE_MESSAGE,
		],
		[
			'GraphQL FORBIDDEN',
			graphQLError('FORBIDDEN'),
			'thread',
			GitHubWriteForbiddenError,
			'FORBIDDEN',
			GITHUB_WRITE_FORBIDDEN_MESSAGE,
		],
		[
			'GraphQL NOT_FOUND',
			graphQLError('NOT_FOUND'),
			'thread',
			GitHubWriteForbiddenError,
			'FORBIDDEN',
			GITHUB_WRITE_FORBIDDEN_MESSAGE,
		],
		[
			'GraphQL UNAUTHORIZED',
			graphQLError('UNAUTHORIZED'),
			'thread',
			GitHubReconnectRequiredError,
			'UNAUTHORIZED',
			GITHUB_RECONNECT_REQUIRED_MESSAGE,
		],
		[
			'GraphQL RATE_LIMITED',
			graphQLError('RATE_LIMITED'),
			'thread',
			GitHubRateLimitedError,
			'TOO_MANY_REQUESTS',
			GITHUB_RATE_LIMITED_MESSAGE,
		],
		[
			'GraphQL UNPROCESSABLE',
			graphQLError('UNPROCESSABLE'),
			'comment',
			GitHubWriteRejectedError,
			'CONFLICT',
			GITHUB_WRITE_REJECTED_MESSAGES.invalid_anchor,
		],
	] as const)('maps %s to a safe domain error', (_name, providerError, action, errorClass, code, message) => {
		const error = toGitHubWriteError(providerError, action)

		expect(error).toBeInstanceOf(errorClass)
		expect(error).toMatchObject({ code, message })
		expect(error.message).not.toContain(PROVIDER_DETAIL)
	})
})

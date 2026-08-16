import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { GitHubLookupUnavailableError } from '../domain/organization.errors'

const GITHUB_REQUEST_TIMEOUT_MS = 5000

const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

export type GitHubLoginLookup =
	| { exists: true; id: number; login: string }
	| { exists: false }

// `null` sends the request unauthenticated, which the lookup endpoint allows at
// GitHub's 60 requests/hour per-IP limit.
export interface GitHubLoginAuth {
	accessToken: string | null
}

interface GitHubRequestErrorLike {
	status: number
}

@Injectable()
export class GitHubLoginClient {
	private readonly logger = new Logger(GitHubLoginClient.name)

	// Only 200 and 404 are answers: treating an unanswered lookup as "nobody
	// owns this" would hand out a login during an outage.
	async lookupLogin(
		login: string,
		auth: GitHubLoginAuth
	): Promise<GitHubLoginLookup> {
		try {
			const response = await this.requestUser(login, auth.accessToken)

			return { exists: true, id: response.data.id, login: response.data.login }
		} catch (error) {
			if (isGitHubRequestError(error, HTTP_NOT_FOUND)) return { exists: false }

			throw this.toLookupUnavailableError(error)
		}
	}

	private async requestUser(login: string, accessToken: string | null) {
		try {
			return await requestGitHubUser(login, accessToken)
		} catch (error) {
			// 403 fails closed; only a 401 (bad credentials) retries anonymously,
			// which can never see more than the token-less path already allows.
			if (!(accessToken && isGitHubRequestError(error, HTTP_UNAUTHORIZED)))
				throw error

			this.logger.warn(
				'GitHub rejected the stored account token; retrying unauthenticated'
			)

			return await requestGitHubUser(login, null)
		}
	}

	private toLookupUnavailableError(error: unknown) {
		if (isGitHubRequestError(error)) {
			this.logger.warn(`GitHub login lookup failed with status ${error.status}`)

			return new GitHubLookupUnavailableError(
				{ status: error.status },
				{ cause: error }
			)
		}

		this.logger.warn('GitHub login lookup failed before a response arrived')

		return new GitHubLookupUnavailableError({}, { cause: error })
	}
}

function requestGitHubUser(login: string, accessToken: string | null) {
	const octokit = accessToken
		? new Octokit({ auth: accessToken })
		: new Octokit()

	return octokit.request('GET /users/{username}', {
		username: login,
		request: { signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS) },
	})
}

function isGitHubRequestError(
	error: unknown,
	status?: number
): error is GitHubRequestErrorLike {
	if (!error || typeof error !== 'object' || !('status' in error)) return false
	if (typeof error.status !== 'number') return false

	return status === undefined || error.status === status
}

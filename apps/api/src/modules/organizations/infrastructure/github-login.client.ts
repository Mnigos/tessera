import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import type { GitHubLoginLookup } from '../domain/github-login-claim'
import { GitHubLookupUnavailableError } from '../domain/organization.errors'

/**
 * Long enough for a cold GitHub response, short enough that a hanging provider
 * does not hold an organization form open. A timeout counts as unavailable, not
 * as a free handle.
 */
const GITHUB_REQUEST_TIMEOUT_MS = 5000

const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

/**
 * How the guard authenticates against GitHub.
 *
 * `accessToken` is the actor's stored GitHub OAuth token when Tessera holds a
 * usable one. `null` means the request goes out unauthenticated, which the
 * lookup endpoint allows at GitHub's 60 requests/hour per-IP limit — the Redis
 * cache is what keeps that limit survivable, and a 403/429 from it fails closed
 * like any other unanswered lookup.
 */
export interface GitHubLoginAuth {
	accessToken: string | null
}

interface GitHubRequestErrorLike {
	status: number
}

@Injectable()
export class GitHubLoginClient {
	private readonly logger = new Logger(GitHubLoginClient.name)

	/**
	 * Resolves a login through `GET /users/{username}`, which answers for user
	 * and organization logins alike because GitHub shares that namespace.
	 *
	 * Only 200 and 404 are answers. Everything else — unauthorized, forbidden,
	 * rate limited, 5xx, timeout, DNS — throws, because treating an unanswered
	 * lookup as "nobody owns this" would hand out a login during an outage.
	 */
	async lookupLogin(
		login: string,
		auth: GitHubLoginAuth
	): Promise<GitHubLoginLookup> {
		try {
			const response = await this.withCredentialFallback(auth, currentAuth =>
				this.createOctokit(currentAuth).request('GET /users/{username}', {
					username: login,
					request: {
						signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
					},
				})
			)

			return {
				exists: true,
				id: response.data.id,
				login: response.data.login,
				type: response.data.type === 'Organization' ? 'Organization' : 'User',
			}
		} catch (error) {
			if (isGitHubRequestError(error, HTTP_NOT_FOUND)) return { exists: false }

			throw this.toLookupUnavailableError(error)
		}
	}

	private createOctokit({ accessToken }: GitHubLoginAuth) {
		return accessToken ? new Octokit({ auth: accessToken }) : new Octokit()
	}

	/**
	 * Sends a request, and sends it once more without the actor's token when
	 * GitHub rejected the credential outright.
	 *
	 * Only a 401 qualifies. "Bad credentials" means the token carried no identity
	 * at all, so retrying without it shows exactly the view a user with no linked
	 * GitHub account already gets — the retry can only ever be as permissive as
	 * the token-less path the guard fully supports, and it keeps a revoked token
	 * from locking its owner out of creating any organization.
	 *
	 * A 403 does not qualify and is never retried. It means GitHub answered with
	 * a restriction — SSO enforcement, visibility, secondary rate limits — where
	 * an anonymous retry sees *less* than the credential did. That retry could
	 * turn a restricted 403 into an anonymous 404 and cache a taken handle as
	 * free, so a 403 fails closed immediately.
	 */
	private async withCredentialFallback<TResult>(
		auth: GitHubLoginAuth,
		send: (auth: GitHubLoginAuth) => Promise<TResult>
	): Promise<TResult> {
		try {
			return await send(auth)
		} catch (error) {
			if (!(auth.accessToken && isGitHubRequestError(error, HTTP_UNAUTHORIZED)))
				throw error

			this.logger.warn(
				'GitHub rejected the stored account token; retrying unauthenticated'
			)

			return await send({ accessToken: null })
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

function isGitHubRequestError(
	error: unknown,
	status?: number
): error is GitHubRequestErrorLike {
	if (!error || typeof error !== 'object' || !('status' in error)) return false
	if (typeof error.status !== 'number') return false

	return status === undefined || error.status === status
}

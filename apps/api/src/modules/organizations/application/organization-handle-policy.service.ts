import { Injectable } from '@nestjs/common'
import type { OrganizationId, UserId } from '@repo/domain'
import {
	decideGitHubLoginClaim,
	isGitHubLoginCandidate,
} from '../domain/github-login-claim'
import {
	OrganizationSlugGitHubConflictError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'
import {
	type GitHubLoginAuth,
	GitHubLoginClient,
} from '../infrastructure/github-login.client'
import {
	GITHUB_LOGIN_EXISTS_TTL_SECONDS,
	GITHUB_LOGIN_MISSING_TTL_SECONDS,
	GitHubLoginCacheRepository,
} from '../infrastructure/github-login-cache.repository'
import {
	type GitHubAccountIdentity,
	OrganizationsRepository,
} from '../infrastructure/organizations.repository'

interface AssertAvailableInput {
	slug: string
	actorUserId: UserId
	ignoreOrganizationId?: OrganizationId
}

@Injectable()
export class OrganizationHandlePolicyService {
	constructor(
		private readonly gitHubLoginClient: GitHubLoginClient,
		private readonly gitHubLoginCacheRepository: GitHubLoginCacheRepository,
		private readonly organizationsRepository: OrganizationsRepository
	) {}

	async assertAvailable({
		slug,
		actorUserId,
		ignoreOrganizationId,
	}: AssertAvailableInput): Promise<void> {
		const handle = slug.trim().toLowerCase()

		if (
			await this.organizationsRepository.isHandleTaken({
				handle,
				ignoreOrganizationId,
			})
		)
			throw new OrganizationSlugTakenError({ handle })

		// A handle outside the handle grammar cannot name a GitHub account, so it
		// is not worth a request that can only 404.
		if (!isGitHubLoginCandidate(handle)) return

		await this.assertGitHubLoginClaimable(handle, actorUserId)
	}

	private async assertGitHubLoginClaimable(
		handle: string,
		actorUserId: UserId
	) {
		const cachedLookup = await this.gitHubLoginCacheRepository.get(handle)

		if (cachedLookup && !cachedLookup.exists) return

		const gitHubAccount = await this.organizationsRepository.findGitHubAccount({
			userId: actorUserId,
		})
		const auth = toGitHubLoginAuth(gitHubAccount)
		const actorAccountId = toActorAccountId(gitHubAccount)

		// A shared answer only ever rejects an actor with nothing linked; an actor
		// who could claim gets a live lookup, since a cached one may predate
		// GitHub reassigning the login to somebody else.
		const lookup =
			actorAccountId === null
				? (cachedLookup ??
					(await this.gitHubLoginCacheRepository.withDedupe(
						handle,
						async () => await this.lookupLoginLive(handle, auth)
					)))
				: await this.lookupLoginLive(handle, auth)

		if (!lookup.exists) return

		if (decideGitHubLoginClaim(lookup, actorAccountId) === 'conflict')
			// GitHub follows rename redirects, so the message names the typed
			// handle; the canonical login travels in the context.
			throw new OrganizationSlugGitHubConflictError(handle, {
				canonicalLogin: lookup.login,
			})
	}

	private async lookupLoginLive(handle: string, auth: GitHubLoginAuth) {
		const lookup = await this.gitHubLoginClient.lookupLogin(handle, auth)

		await this.gitHubLoginCacheRepository.set(
			handle,
			lookup,
			lookup.exists
				? GITHUB_LOGIN_EXISTS_TTL_SECONDS
				: GITHUB_LOGIN_MISSING_TTL_SECONDS
		)

		return lookup
	}
}

function toGitHubLoginAuth(
	gitHubAccount: GitHubAccountIdentity | undefined
): GitHubLoginAuth {
	if (!gitHubAccount?.accessToken) return { accessToken: null }

	const isExpired =
		gitHubAccount.accessTokenExpiresAt !== null &&
		gitHubAccount.accessTokenExpiresAt.getTime() <= Date.now()

	return { accessToken: isExpired ? null : gitHubAccount.accessToken }
}

// Better Auth stores the provider account id as text; anything that is not a
// positive integer did not come from GitHub and claims nothing.
function toActorAccountId(gitHubAccount: GitHubAccountIdentity | undefined) {
	if (!gitHubAccount) return null

	const accountId = Number(gitHubAccount.accountId)

	return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null
}

import { Injectable } from '@nestjs/common'
import type { OrganizationId, UserId } from '@repo/domain'
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
		const actorAccountId = toActorAccountId(gitHubAccount)

		// Cached positives may only reject unlinked actors; linked actors look up live.
		const lookup =
			actorAccountId === null && cachedLookup
				? cachedLookup
				: await this.lookupLoginLive(handle, toGitHubLoginAuth(gitHubAccount))

		if (!lookup.exists) return

		// Compare account ids, not logins: logins can be re-registered by strangers.
		if (actorAccountId === null || lookup.id !== actorAccountId)
			// Names the typed handle: GitHub redirects renamed logins.
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

function toActorAccountId(gitHubAccount: GitHubAccountIdentity | undefined) {
	if (!gitHubAccount) return null

	const accountId = Number(gitHubAccount.accountId)

	return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null
}

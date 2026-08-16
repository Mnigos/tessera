import { Injectable } from '@nestjs/common'
import type { OrganizationId, UserId } from '@repo/domain'
import {
	decideGitHubLoginClaim,
	type GitHubLoginLookup,
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
import type { GitHubAccountIdentity } from '../infrastructure/organization-handle-policy.repository'
import { OrganizationHandlePolicyRepository } from '../infrastructure/organization-handle-policy.repository'
import { LocalHandleAvailabilityService } from './local-handle-availability.service'

interface AssertAvailableInput {
	slug: string
	actorUserId: UserId
	ignoreOrganizationId?: OrganizationId
}

/**
 * The single place that decides whether an organization may answer to a handle.
 *
 * Creation and rename both go through it, so a handle can never become
 * reachable by a route that skipped a check. It composes two independent
 * questions — is Tessera already using this handle, and does GitHub already
 * have a login the actor cannot prove is theirs — deliberately kept as separate
 * collaborators because TES-61 replaces the first and leaves the second alone.
 */
@Injectable()
export class OrganizationHandlePolicyService {
	constructor(
		private readonly localHandleAvailabilityService: LocalHandleAvailabilityService,
		private readonly gitHubLoginClient: GitHubLoginClient,
		private readonly gitHubLoginCacheRepository: GitHubLoginCacheRepository,
		private readonly handlePolicyRepository: OrganizationHandlePolicyRepository
	) {}

	/**
	 * Throws unless the actor may take the handle.
	 *
	 * Local conflicts are checked first because they are free and are the common
	 * answer. `ignoreOrganizationId` is what lets a rename keep its own handle.
	 *
	 * The GitHub half fails closed: an unanswered lookup throws
	 * `GitHubLookupUnavailableError` rather than treating silence as consent,
	 * because an organization handle is effectively permanent once it has clone
	 * URLs pointing at it.
	 */
	async assertAvailable({
		slug,
		actorUserId,
		ignoreOrganizationId,
	}: AssertAvailableInput): Promise<void> {
		const handle = slug.trim().toLowerCase()

		if (
			await this.localHandleAvailabilityService.isTaken(
				handle,
				ignoreOrganizationId
			)
		)
			throw new OrganizationSlugTakenError({ handle })

		// A handle GitHub could not hold cannot collide with a GitHub login, and
		// the contract schema has already rejected it for every real caller.
		if (!isGitHubLoginCandidate(handle)) return

		await this.assertGitHubLoginClaimable(handle, actorUserId)
	}

	private async assertGitHubLoginClaimable(
		handle: string,
		actorUserId: UserId
	) {
		const cachedLookup = await this.gitHubLoginCacheRepository.get(handle)

		// A handle GitHub reported free needs neither the actor's identity nor their
		// token, and the short negative TTL bounds how stale that answer can be.
		// This is the path almost every creation takes.
		if (cachedLookup && !cachedLookup.exists) return

		const gitHubAccount = await this.handlePolicyRepository.findGitHubAccount({
			userId: actorUserId,
		})
		const auth = toGitHubLoginAuth(gitHubAccount)
		const actorAccountId = toActorAccountId(gitHubAccount)

		// An actor with nothing linked can claim nothing, so any positive answer
		// only ever rejects and a cached or shared one is as good as a fresh one.
		// An actor who could claim gets a lookup of their own: anything a cache or
		// another caller hands back may predate GitHub reassigning the login, and
		// granting on that would let an actor whose account once held the login
		// keep taking it after somebody else was given it.
		const lookup =
			actorAccountId === null
				? (cachedLookup ?? (await this.lookupSharedLogin(handle, auth)))
				: await this.lookupLoginLive(handle, auth)

		if (!lookup.exists) return

		if (decideGitHubLoginClaim(lookup, actorAccountId) === 'conflict')
			// The message quotes the handle that was asked for, not the canonical
			// login: `GET /users/{login}` follows GitHub's rename redirects, so those
			// differ exactly when naming the canonical one would tell somebody about
			// an account they never mentioned.
			throw new OrganizationSlugGitHubConflictError(handle, {
				canonicalLogin: lookup.login,
			})
	}

	/**
	 * A lookup that may be answered by whoever is already performing one.
	 *
	 * The cache write lives inside the deduplicated section so the answer is
	 * published while the callers that lost the lock are still watching for it.
	 * Those callers read it back off the result key, so what they receive can be
	 * older than this call — which is why only actors who cannot claim anything
	 * are served this way. A lookup that threw never reaches the write, so
	 * failures are never cached.
	 */
	private async lookupSharedLogin(handle: string, auth: GitHubLoginAuth) {
		return await this.gitHubLoginCacheRepository.withDedupe(
			handle,
			async () => await this.lookupLoginLive(handle, auth)
		)
	}

	/**
	 * A lookup this call made itself, which is the only kind a claim may be
	 * granted on.
	 *
	 * It deliberately skips both the cache read and the deduplication: either
	 * could hand back an answer taken before GitHub moved the login, and the
	 * whole point of the claim check is that the account behind the login is the
	 * one it is right now. The answer is still published for everyone else, and a
	 * failed lookup still reaches no write.
	 */
	private async lookupLoginLive(handle: string, auth: GitHubLoginAuth) {
		const lookup = await this.gitHubLoginClient.lookupLogin(handle, auth)

		await this.gitHubLoginCacheRepository.set(
			handle,
			lookup,
			toLookupTtlSeconds(lookup)
		)

		return lookup
	}
}

/**
 * Picks the credential the GitHub lookups run under.
 *
 * A token Tessera already knows has expired is dropped rather than presented,
 * saving a request that would only be refused. Without a usable token the
 * lookup goes out unauthenticated, which the endpoint allows.
 */
function toGitHubLoginAuth(
	gitHubAccount: GitHubAccountIdentity | undefined
): GitHubLoginAuth {
	if (!gitHubAccount?.accessToken) return { accessToken: null }

	const isExpired =
		gitHubAccount.accessTokenExpiresAt !== null &&
		gitHubAccount.accessTokenExpiresAt.getTime() <= Date.now()

	return { accessToken: isExpired ? null : gitHubAccount.accessToken }
}

/**
 * The actor's GitHub account as a number the claim can be decided on.
 *
 * Better Auth stores the provider's account id as text; anything that is not a
 * positive integer did not come from GitHub and grants no claim, which is the
 * same answer as having linked nothing.
 */
function toActorAccountId(gitHubAccount: GitHubAccountIdentity | undefined) {
	if (!gitHubAccount) return null

	const accountId = Number(gitHubAccount.accountId)

	return Number.isSafeInteger(accountId) && accountId > 0 ? accountId : null
}

function toLookupTtlSeconds(lookup: GitHubLoginLookup) {
	return lookup.exists
		? GITHUB_LOGIN_EXISTS_TTL_SECONDS
		: GITHUB_LOGIN_MISSING_TTL_SECONDS
}

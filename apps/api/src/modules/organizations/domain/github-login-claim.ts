import { HANDLE_MAX_LENGTH, HANDLE_REGEX } from '@repo/domain'

/**
 * GitHub's shared user/organization namespace has exactly two kinds of account
 * behind a login, and `GET /users/{username}` answers for both.
 */
export type GitHubLoginAccountType = 'User' | 'Organization'

/**
 * What GitHub reported about a login, reduced to what the handle policy needs
 * and to what is safe to cache.
 *
 * `id` is GitHub's immutable numeric account id and is the only field a claim
 * may be decided on. `login` is mutable — accounts rename, and the endpoint
 * follows rename redirects, so an old login resolves to the account's current
 * one — which makes it fit for messages and unfit for authorization.
 *
 * A lookup that failed is never one of these shapes: an unanswered lookup is an
 * error, not a result, because storing it would turn an outage into a free
 * handle.
 */
export type GitHubLoginLookup =
	| {
			exists: true
			id: number
			login: string
			type: GitHubLoginAccountType
	  }
	| { exists: false }

/**
 * Whether an existing GitHub login blocks the handle. `available` covers both
 * "no GitHub account owns this" and "the actor owns it", because the guard only
 * exists to stop someone claiming a login that is not theirs.
 */
export type GitHubLoginClaimDecision = 'available' | 'conflict'

/**
 * Whether a normalized handle is worth asking GitHub about.
 *
 * Tessera's handle format mirrors GitHub's login rules, so anything outside it
 * cannot name a GitHub account and cannot collide with one. Such a handle skips
 * the lookup rather than spending a request on a guaranteed 404 — the contract
 * schema has already refused it for every caller that comes through the API.
 */
export function isGitHubLoginCandidate(handle: string) {
	return handle.length <= HANDLE_MAX_LENGTH && HANDLE_REGEX.test(handle)
}

/**
 * Decides whether an existing GitHub login stands in the way of a handle.
 *
 * The claim is settled on GitHub account ids, never on login strings. A login
 * can be released and re-registered by a stranger, so an actor whose linked
 * account once answered to it would keep matching it by name; the numeric id
 * moves with the account and cannot be inherited. `actorAccountId` is `null`
 * when the actor has no linked GitHub identity and so can claim nothing.
 */
export function decideGitHubLoginClaim(
	lookup: GitHubLoginLookup,
	actorAccountId: number | null
): GitHubLoginClaimDecision {
	if (!lookup.exists) return 'available'
	if (actorAccountId === null) return 'conflict'

	return lookup.id === actorAccountId ? 'available' : 'conflict'
}

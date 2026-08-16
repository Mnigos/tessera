import { HANDLE_MAX_LENGTH, HANDLE_REGEX } from '@repo/domain'

export type GitHubLoginAccountType = 'User' | 'Organization'

export type GitHubLoginLookup =
	| {
			exists: true
			id: number
			login: string
			type: GitHubLoginAccountType
	  }
	| { exists: false }

export type GitHubLoginClaimDecision = 'available' | 'conflict'

export function isGitHubLoginCandidate(handle: string) {
	return handle.length <= HANDLE_MAX_LENGTH && HANDLE_REGEX.test(handle)
}

// Decided on GitHub's immutable account id, never on the login string: a login
// can be released and re-registered by a stranger.
export function decideGitHubLoginClaim(
	lookup: GitHubLoginLookup,
	actorAccountId: number | null
): GitHubLoginClaimDecision {
	if (!lookup.exists) return 'available'
	if (actorAccountId === null) return 'conflict'

	return lookup.id === actorAccountId ? 'available' : 'conflict'
}

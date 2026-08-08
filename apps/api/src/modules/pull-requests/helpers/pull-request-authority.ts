import type { PullRequestAuthority } from '@repo/contracts'

/**
 * Which system owns the pull request surface the viewer is looking at. It comes
 * from the repository's external source rather than the pull request's own
 * provider: after a cutover a GitHub-origin pull request keeps its provenance
 * while Tessera writes again, and the read-only UI must follow the repository.
 */
export function toPullRequestAuthority(
	tesseraWritesAllowed: boolean
): PullRequestAuthority {
	return tesseraWritesAllowed ? 'tessera' : 'github'
}

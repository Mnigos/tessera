import { isHttpCloneUrl, type RepositoryCloneUrls } from '@repo/contracts'
import type { RepositoryExternalSourceReadModel } from './repository'

export interface RepositoryCloneBaseUrls {
	http: string
	ssh: string
}

interface RepositoryCloneUrlsParams {
	baseUrls: RepositoryCloneBaseUrls
	externalSource?: RepositoryExternalSourceReadModel | null
	ownerHandle: string
	slug: string
}

const TRAILING_SLASHES_REGEX = /\/+$/

/**
 * Which remote a person should actually be given.
 *
 * Only a running `github_to_tessera` mirror puts the answer on GitHub: an
 * imported snapshot is already Tessera's, and a repository that has cut over is
 * Tessera's again. Handing out a Tessera remote while GitHub owns the
 * repository would offer a clone whose pushes are refused.
 */
export function toRepositoryCloneUrls({
	baseUrls,
	externalSource,
	ownerHandle,
	slug,
}: RepositoryCloneUrlsParams): RepositoryCloneUrls {
	const gitHubUrls =
		externalSource?.mirrorMode === 'github_to_tessera'
			? toGitHubCloneUrls(externalSource)
			: undefined

	if (gitHubUrls) return gitHubUrls

	const path = `/${ownerHandle}/${slug}.git`

	return {
		authority: 'tessera',
		https: `${trimTrailingSlashes(baseUrls.http)}${path}`,
		ssh: `${trimTrailingSlashes(baseUrls.ssh)}${path}`,
	}
}

/**
 * Built from the stored source URL rather than a hardcoded github.com so a
 * GitHub Enterprise host survives; a source URL that cannot be parsed falls
 * back to Tessera's own remotes instead of guessing a host.
 *
 * The two forms disagree about the port on purpose. HTTPS keeps it, because a
 * self-hosted instance on a non-default port is reached through it. SSH drops
 * it, because scp-like syntax reads everything after the colon as the path —
 * `git@host:8443:owner/repo.git` is not a remote anybody can clone, and Git's
 * SSH port belongs in configuration rather than in the HTTP URL's port.
 */
function toGitHubCloneUrls({
	fullName,
	sourceUrl,
}: RepositoryExternalSourceReadModel): RepositoryCloneUrls | undefined {
	const source = toSourceUrl(sourceUrl)

	if (!source) return undefined

	return {
		authority: 'github',
		https: `${source.protocol}//${source.host}/${fullName}.git`,
		ssh: `git@${source.hostname}:${fullName}.git`,
	}
}

/**
 * Only a web source can produce a web clone URL. A stored source with any other
 * scheme would otherwise be copied straight into `cloneUrls.https`, which the
 * contract refuses — so it falls back to Tessera's own remotes instead of
 * failing every read of the repository.
 */
function toSourceUrl(sourceUrl: string): URL | undefined {
	try {
		const parsed = new URL(sourceUrl)

		if (!(parsed.hostname && isHttpCloneUrl(sourceUrl))) return undefined

		return parsed
	} catch {
		return undefined
	}
}

function trimTrailingSlashes(value: string) {
	return value.replace(TRAILING_SLASHES_REGEX, '')
}

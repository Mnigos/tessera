import {
	and,
	type DrizzleTransaction,
	eq,
	repositoryExternalSources,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'

/**
 * Another run owns this repository now, so nothing this one does may still be
 * written. It carries its own type because stages that contain a single item's
 * failure and carry on must still abort whole on this one.
 */
export class GitHubSyncAuthorityError extends Error {
	constructor() {
		super('GitHub synchronization authority changed')
		this.name = 'GitHubSyncAuthorityError'
	}
}

/**
 * The fence every projection commits behind. Reading the external source `for
 * update` inside the transaction means a run whose authority changed or whose
 * lease was taken over aborts before it writes anything, so no projection can
 * leave half of a snapshot committed.
 */
export async function assertGitHubSyncAuthority(
	transaction: DrizzleTransaction,
	{
		authorityGeneration,
		leaseOwner,
		repositoryId,
	}: {
		authorityGeneration: number
		leaseOwner: string
		repositoryId: RepositoryId
	}
): Promise<void> {
	const [source] = await transaction
		.select({ id: repositoryExternalSources.id })
		.from(repositoryExternalSources)
		.where(
			and(
				eq(repositoryExternalSources.repositoryId, repositoryId),
				eq(repositoryExternalSources.authorityGeneration, authorityGeneration),
				eq(repositoryExternalSources.syncLeaseOwner, leaseOwner),
				eq(repositoryExternalSources.mirrorMode, 'github_to_tessera')
			)
		)
		.limit(1)
		.for('update')

	if (!source) throw new GitHubSyncAuthorityError()
}

import {
	and,
	type DrizzleTransaction,
	eq,
	repositoryExternalSources,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'

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

	if (!source) throw new Error('GitHub synchronization authority changed')
}

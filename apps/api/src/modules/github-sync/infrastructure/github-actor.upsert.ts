import {
	account,
	and,
	type DrizzleTransaction,
	eq,
	type GitHubActorId,
	gitHubActors,
	or,
} from '@repo/db'
import type { GitHubSyncActor } from './github-sync.client.types'

// The lookup matches either identity: a moved login splits the two unique indexes.
export async function upsertGitHubActor(
	db: DrizzleTransaction,
	actor: GitHubSyncActor
): Promise<GitHubActorId> {
	const [linkedAccount] = await db
		.select({ userId: account.userId })
		.from(account)
		.where(
			and(
				eq(account.providerId, 'github'),
				eq(account.accountId, actor.numericId.toString())
			)
		)
		.limit(1)
	const actorValues = {
		externalNodeId: actor.nodeId,
		externalNumericId: actor.numericId,
		login: actor.login,
		type: actor.type,
		avatarUrl: actor.avatarUrl,
		htmlUrl: actor.htmlUrl,
		userId: linkedAccount?.userId,
	}

	const [insertedActor] = await db
		.insert(gitHubActors)
		.values(actorValues)
		.onConflictDoNothing()
		.returning({ id: gitHubActors.id })

	if (insertedActor) return insertedActor.id

	const [existingActor] = await db
		.select({ id: gitHubActors.id })
		.from(gitHubActors)
		.where(
			or(
				eq(gitHubActors.externalNodeId, actor.nodeId),
				eq(gitHubActors.externalNumericId, actor.numericId)
			)
		)
		.limit(1)

	if (!existingActor) throw new Error('failed to resolve GitHub actor')

	const [storedActor] = await db
		.update(gitHubActors)
		.set(actorValues)
		.where(eq(gitHubActors.id, existingActor.id))
		.returning({ id: gitHubActors.id })

	if (!storedActor) throw new Error('failed to persist GitHub actor')

	return storedActor.id
}

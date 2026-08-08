import type { PullRequestActor } from '@repo/contracts'
import type { UserId } from '@repo/domain'

/**
 * What every actor-bearing read selects: the native account when Tessera knows
 * the identity, and the GitHub snapshot the projection kept when it does not. A
 * synchronized row carries one side or the other, so both are nullable here and
 * exactly one of them survives into the output.
 */
export interface PullRequestActorReadModel {
	userId: UserId | null
	username: string | null
	externalNodeId: string | null
	externalLogin: string | null
	externalAvatarUrl: string | null
	externalHtmlUrl: string | null
}

/**
 * An actor is native whenever a Tessera account backs the action, and external
 * only when GitHub is the sole place it exists. External actors are keyed by
 * node ID rather than login or user ID: logins are renameable, and every
 * unmapped actor shares a null user ID, so neither can key a row on its own.
 *
 * Undefined when neither side identifies anybody, which the callers that need
 * an actor turn into a failure and the optional ones drop.
 */
export function toPullRequestActorOutput(
	actor: PullRequestActorReadModel
): PullRequestActor | undefined {
	if (actor.userId && actor.username)
		return {
			key: actor.userId,
			provider: 'tessera',
			userId: actor.userId,
			username: actor.username,
		}

	if (!(actor.externalNodeId && actor.externalLogin)) return undefined

	return {
		key: actor.externalNodeId,
		provider: 'github',
		username: actor.externalLogin,
		externalNodeId: actor.externalNodeId,
		avatarUrl: actor.externalAvatarUrl ?? undefined,
		htmlUrl: actor.externalHtmlUrl ?? undefined,
	}
}

export function requirePullRequestActorOutput(
	actor: PullRequestActorReadModel,
	subject: string
): PullRequestActor {
	const output = toPullRequestActorOutput(actor)

	if (!output) throw new Error(`${subject} identity is unavailable`)

	return output
}

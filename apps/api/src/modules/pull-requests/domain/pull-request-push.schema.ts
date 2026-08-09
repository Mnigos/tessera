import { PushRefUpdateKind } from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { z } from 'zod'

const HEADS_REF_PREFIX = 'refs/heads/'
const NULL_SHA_REGEX = /^0+$/
/** Git's own rules, as far as a branch under `refs/heads/` can break them. */
const FORBIDDEN_BRANCH_CHARACTERS = /[\s~^:?*[\]\\]|\p{Cc}/u
const MAX_BRANCH_LENGTH = 255
/** More refs than any real push moves, and few enough to lock in one query. */
const MAX_UPDATES = 1000
/** Beyond this a timestamp is not a date at all: `new Date` yields `Invalid Date`. */
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000

const pushShaSchema = z
	.string()
	.regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)
	.refine(sha => !NULL_SHA_REGEX.test(sha))

const pushRefUpdateSchema = z
	.object({
		refName: z
			.string()
			.startsWith(HEADS_REF_PREFIX)
			.refine(ref => isBranchRef(ref.slice(HEADS_REF_PREFIX.length))),
		oldSha: pushShaSchema,
		newSha: pushShaSchema,
		kind: z.literal([
			PushRefUpdateKind.PUSH_REF_UPDATE_KIND_HEAD_UPDATED,
			PushRefUpdateKind.PUSH_REF_UPDATE_KIND_FORCE_PUSHED,
		]),
	})
	// A branch that did not move is not a movement, whatever the sender says.
	.refine(update => update.oldSha !== update.newSha)
	.transform(update => ({
		ref: update.refName,
		sourceBranch: update.refName.slice(HEADS_REF_PREFIX.length),
		oldSha: update.oldSha,
		newSha: update.newSha,
		type:
			update.kind === PushRefUpdateKind.PUSH_REF_UPDATE_KIND_FORCE_PUSHED
				? ('force_pushed' as const)
				: ('head_updated' as const),
	}))

/**
 * A delivered push, as the Git service observed it. Whether the branch moved
 * forward or was rewritten is decided there, while the old commit is still
 * reachable, so the notification carries the verdict rather than the evidence
 * for it.
 */
export const pullRequestPushNotificationSchema = z
	.object({
		operationId: z.uuid(),
		repositoryId: z.uuid().brand<'repository_id'>(),
		actorUserId: z.uuid().brand<'user_id'>(),
		occurredAtUnixMs: z.coerce.number().int().positive().max(MAX_TIMESTAMP_MS),
		updates: z.array(pushRefUpdateSchema).min(1).max(MAX_UPDATES),
	})
	.transform(({ occurredAtUnixMs, ...notification }) => ({
		...notification,
		occurredAt: new Date(occurredAtUnixMs),
	}))

export type PullRequestPushNotification = z.infer<
	typeof pullRequestPushNotificationSchema
>
export type PullRequestPushRefUpdate =
	PullRequestPushNotification['updates'][number]

function isBranchRef(branch: string) {
	if (branch.length === 0 || branch.length > MAX_BRANCH_LENGTH) return false

	if (
		branch.includes('..') ||
		branch.includes('@{') ||
		branch.includes('//') ||
		branch.startsWith('/') ||
		branch.endsWith('/') ||
		branch.endsWith('.') ||
		branch.endsWith('.lock')
	)
		return false

	return !FORBIDDEN_BRANCH_CHARACTERS.test(branch)
}

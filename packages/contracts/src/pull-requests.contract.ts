import { oc } from '@orpc/contract'
import {
	mergeBlockingReasonCodes,
	mergeQueueStates,
	mergeStrategies,
	mergeStrategyUnavailableReasons,
} from '@repo/domain'
import { z } from 'zod'
import { branchProtectionRuleIdSchema } from './branch-protection.contract'
import {
	checksListSchema,
	checksSummarySchema,
	requiredContextEvaluationSchema,
} from './checks.contract'
import {
	repositorySlugSchema,
	repositoryViewerRoleSchema,
} from './repositories.contract'

export const PULL_REQUEST_STALE_COMPARISON_MESSAGE =
	'The source or target branch changed. Refresh the pull request and try again.'

const pullRequestShaSchema = z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/)

export const pullRequestIdSchema = z.uuid().brand<'pull_request_id'>()
export type PullRequestId = z.infer<typeof pullRequestIdSchema>

export const pullRequestThreadIdSchema = z
	.uuid()
	.brand<'pull_request_thread_id'>()
export type PullRequestThreadId = z.infer<typeof pullRequestThreadIdSchema>

export const pullRequestCommentIdSchema = z
	.uuid()
	.brand<'pull_request_comment_id'>()
export type PullRequestCommentId = z.infer<typeof pullRequestCommentIdSchema>

export const pullRequestReviewIdSchema = z
	.uuid()
	.brand<'pull_request_review_id'>()
export type PullRequestReviewId = z.infer<typeof pullRequestReviewIdSchema>

export const pullRequestReviewerRequestIdSchema = z
	.uuid()
	.brand<'pull_request_reviewer_request_id'>()
export type PullRequestReviewerRequestId = z.infer<
	typeof pullRequestReviewerRequestIdSchema
>

export const mergeQueueEntryIdSchema = z.uuid().brand<'merge_queue_entry_id'>()
export type MergeQueueEntryId = z.infer<typeof mergeQueueEntryIdSchema>

export const pullRequestStateSchema = z.enum(['open', 'closed', 'merged'])
export type PullRequestState = z.infer<typeof pullRequestStateSchema>

export const mergeQueueStateSchema = z.enum(mergeQueueStates)
export type MergeQueueState = z.infer<typeof mergeQueueStateSchema>

export const mergeBlockingReasonCodeSchema = z.enum(mergeBlockingReasonCodes)

export const mergeStrategySchema = z.enum(mergeStrategies)
export type MergeStrategy = z.infer<typeof mergeStrategySchema>

export const mergeStrategyUnavailableReasonSchema = z.enum(
	mergeStrategyUnavailableReasons
)
export type MergeStrategyUnavailableReason = z.infer<
	typeof mergeStrategyUnavailableReasonSchema
>

/**
 * Whether one strategy could run against the branches as they currently stand.
 * Every strategy gets an entry, available or not, so the client can show all
 * four with the one that is refused explaining itself rather than disappearing.
 */
export const mergeStrategyAvailabilitySchema = z.object({
	strategy: mergeStrategySchema,
	available: z.boolean(),
	reason: mergeStrategyUnavailableReasonSchema.optional(),
})
export type MergeStrategyAvailability = z.infer<
	typeof mergeStrategyAvailabilitySchema
>

/**
 * A NUL cannot be represented in a Git commit object at all, so Git storage
 * refuses one — which would surface as an unmergeable pull request rather than
 * as the invalid input it is.
 *
 * Applied by chaining onto the schema that already trims, never by intersecting
 * two schemas: an intersection runs both against the untouched input and then
 * demands the two results match, so a trimmed value and an untrimmed one cannot
 * be reconciled and the parse throws rather than returning an error.
 */
function refuseNul<Schema extends z.ZodType<string>>(schema: Schema) {
	return schema.refine(
		value => !value.includes('\0'),
		'The text must not contain NUL'
	)
}

/** Free text that ends up inside a Git commit message. */
const commitSafeBodySchema = refuseNul(z.string().max(65_536))

/** A commit subject, which is one line by definition. */
const mergeCommitTitleSchema = refuseNul(
	z
		.string()
		.trim()
		.min(1)
		.max(256)
		.regex(/^[^\r\n]+$/, 'The title must be a single line')
)

export const pullRequestProviderSchema = z.enum(['tessera', 'github'])
export type PullRequestProvider = z.infer<typeof pullRequestProviderSchema>

/**
 * Which system owns the pull request surface. Tessera rejects every mutation on
 * a GitHub-authoritative repository, so this is what the UI must hide controls
 * on. It is deliberately separate from `pullRequest.provider`: after cutover a
 * GitHub-origin pull request stays provider-attributed while Tessera writes.
 */
export const pullRequestAuthoritySchema = z.enum(['tessera', 'github'])
export type PullRequestAuthority = z.infer<typeof pullRequestAuthoritySchema>

/**
 * Whoever performed an action on a pull request, native or synchronized. A
 * GitHub actor that was never linked to a Tessera account has no `userId` but
 * always has a login snapshot, so `username` stays required. `key` is stable
 * across reconciliations — native user ID when mapped, GitHub node ID
 * otherwise — and is what list rows must be keyed and grouped by, because
 * logins are renameable and unmapped actors share a null user ID.
 */
export const pullRequestActorSchema = z.object({
	key: z.string().min(1),
	provider: pullRequestProviderSchema,
	userId: z.uuid().brand<'user_id'>().optional(),
	username: z.string().min(1),
	externalNodeId: z.string().min(1).optional(),
	avatarUrl: z.url().optional(),
	htmlUrl: z.url().optional(),
})
export type PullRequestActor = z.infer<typeof pullRequestActorSchema>

export const pullRequestEventTypeSchema = z.enum([
	'opened',
	'edited',
	'closed',
	'reopened',
	'merged',
	'synchronized',
	'retargeted',
	'converted_to_draft',
	'ready_for_review',
	'assigned',
	'review_requested',
	'labeled',
	'commented',
	'thread_resolved',
	'thread_unresolved',
	'review_request_removed',
	'review_submitted',
	'review_dismissed',
	'merge_blocked',
	'merge_bypassed',
	'queue_entered',
	'queue_paused',
	'queue_resumed',
	'queue_removed',
	'head_updated',
	'force_pushed',
])
export type PullRequestEventType = z.infer<typeof pullRequestEventTypeSchema>

export const pullRequestThreadKindSchema = z.enum(['top_level', 'inline'])
export type PullRequestThreadKind = z.infer<typeof pullRequestThreadKindSchema>

export const pullRequestThreadSideSchema = z.enum(['left', 'right'])
export type PullRequestThreadSide = z.infer<typeof pullRequestThreadSideSchema>

export const pullRequestCommentStateSchema = z.enum(['published', 'pending'])
export type PullRequestCommentState = z.infer<
	typeof pullRequestCommentStateSchema
>

export const pullRequestReviewOutcomeSchema = z.enum([
	'approve',
	'request_changes',
	'comment',
])
export type PullRequestReviewOutcome = z.infer<
	typeof pullRequestReviewOutcomeSchema
>

/**
 * A dismissed review keeps the outcome it was submitted with; dismissal is a
 * lifecycle state, never an outcome, so the original approval or change request
 * stays readable in history. Only a synchronized review first seen dismissed has
 * none: the provider had already replaced it before Tessera ever saw the review.
 */
export const pullRequestReviewStateSchema = z.enum([
	'pending',
	'submitted',
	'dismissed',
])
export type PullRequestReviewState = z.infer<
	typeof pullRequestReviewStateSchema
>

export const pullRequestReviewerTargetKindSchema = z.enum(['user', 'team'])
export type PullRequestReviewerTargetKind = z.infer<
	typeof pullRequestReviewerTargetKindSchema
>

export const pullRequestSchema = z.object({
	id: pullRequestIdSchema,
	repositoryId: z.uuid().brand<'repository_id'>(),
	provider: pullRequestProviderSchema,
	number: z.number().int().positive(),
	authorUserId: z.uuid().brand<'user_id'>().optional(),
	authorUsername: z.string().min(1),
	sourceBranch: z.string(),
	targetBranch: z.string(),
	openingBaseSha: z.string(),
	openingHeadSha: z.string(),
	title: z.string(),
	body: z.string(),
	state: pullRequestStateSchema,
	/**
	 * Where the target branch was left. Named for the two-parent merge that was
	 * once the only way to get there — a squash leaves one commit, a rebase the
	 * last replayed one, and a fast-forward the source head itself.
	 */
	mergeCommitSha: z.string().optional(),
	/** Absent on merges made before strategies existed and on synchronized ones. */
	mergeStrategy: mergeStrategySchema.optional(),
	mergeActorUserId: z.uuid().brand<'user_id'>().optional(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
	closedAt: z.coerce.date().optional(),
	mergedAt: z.coerce.date().optional(),
	github: z
		.object({
			nodeId: z.string().min(1),
			htmlUrl: z.url(),
			draft: z.boolean(),
			headSha: z.string().min(1),
			baseSha: z.string().min(1),
			mergedByUsername: z.string().min(1).optional(),
		})
		.optional(),
})
export type PullRequest = z.infer<typeof pullRequestSchema>

const pullRequestThreadEventPayloadSchema = z.object({
	threadId: pullRequestThreadIdSchema,
	commentId: pullRequestCommentIdSchema.optional(),
	threadKind: pullRequestThreadKindSchema,
	path: z.string().optional(),
})

const pullRequestReviewerEventPayloadSchema = z.object({
	reviewerUserId: z.uuid().brand<'user_id'>(),
	reviewerUsername: z.string().min(1),
})

const pullRequestReviewEventPayloadSchema = z.object({
	reviewId: pullRequestReviewIdSchema,
	outcome: pullRequestReviewOutcomeSchema.optional(),
	headSha: z.string(),
})

const pullRequestMergeBlockedEventPayloadSchema = z.object({
	ruleId: branchProtectionRuleIdSchema.optional(),
	ruleVersion: z.number().int().positive().optional(),
	reasonCodes: z.array(mergeBlockingReasonCodeSchema),
	baseSha: z.string().optional(),
	headSha: z.string().optional(),
})

const pullRequestMergeBypassedEventPayloadSchema = z.object({
	ruleId: branchProtectionRuleIdSchema.optional(),
	ruleVersion: z.number().int().positive().optional(),
	reason: z.string().min(1),
	bypassedReasonCodes: z.array(mergeBlockingReasonCodeSchema),
	baseSha: z.string(),
	headSha: z.string(),
})

const pullRequestQueueEnteredEventPayloadSchema = z.object({
	queueEntryId: mergeQueueEntryIdSchema,
	position: z.number().int().positive(),
	enqueuedHeadSha: z.string(),
})

const pullRequestQueuePausedEventPayloadSchema = z.object({
	queueEntryId: mergeQueueEntryIdSchema,
	reasonCodes: z.array(mergeBlockingReasonCodeSchema),
	evaluatedBaseSha: z.string().optional(),
	evaluatedHeadSha: z.string().optional(),
})

const pullRequestQueueRemovedEventPayloadSchema = z.object({
	queueEntryId: mergeQueueEntryIdSchema,
	position: z.number().int().positive(),
	reason: z.enum(['user', 'admin', 'closed', 'merged']),
})

const pullRequestQueueResumedEventPayloadSchema = z.object({
	queueEntryId: mergeQueueEntryIdSchema,
	position: z.number().int().positive(),
})

const pullRequestHeadUpdateEventPayloadSchema = z.object({
	ref: z.string().min(1),
	oldSha: pullRequestShaSchema,
	newSha: pullRequestShaSchema,
})

/**
 * What a merge did, as immutable evidence beside the row it changed. Absent on
 * merges made before strategies existed and on synchronized ones, so a reader
 * has to tolerate a merged event that says nothing.
 */
const pullRequestMergedEventPayloadSchema = z.object({
	strategy: mergeStrategySchema,
	resultingSha: z.string(),
	baseSha: z.string(),
	headSha: z.string(),
})

// Payloads carry no discriminator of their own and the first member that parses
// wins, so a member whose required fields are a subset of another's would
// silently strip the difference. Every shape is listed before any shape it is
// contained by: paused before blocked, entered and removed before resumed.
const pullRequestEventPayloadSchema = z.union([
	pullRequestThreadEventPayloadSchema,
	pullRequestReviewerEventPayloadSchema,
	pullRequestReviewEventPayloadSchema,
	pullRequestQueuePausedEventPayloadSchema,
	pullRequestMergeBlockedEventPayloadSchema,
	pullRequestMergeBypassedEventPayloadSchema,
	pullRequestQueueEnteredEventPayloadSchema,
	pullRequestQueueRemovedEventPayloadSchema,
	pullRequestQueueResumedEventPayloadSchema,
	pullRequestHeadUpdateEventPayloadSchema,
	pullRequestMergedEventPayloadSchema,
])

export const pullRequestEventSchema = z.object({
	id: z.uuid().brand<'pull_request_event_id'>(),
	pullRequestId: pullRequestIdSchema,
	provider: pullRequestProviderSchema,
	actorUserId: z.uuid().brand<'user_id'>().optional(),
	// Absent for system-authored queue transitions; every other event names its
	// actor.
	actorUsername: z.string().min(1).optional(),
	type: pullRequestEventTypeSchema,
	payload: pullRequestEventPayloadSchema.optional(),
	createdAt: z.coerce.date(),
})
export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>

export const pullRequestChangedFileStatusSchema = z.enum([
	'added',
	'modified',
	'deleted',
	'renamed',
])
export type PullRequestChangedFileStatus = z.infer<
	typeof pullRequestChangedFileStatusSchema
>

export const pullRequestChangedFileSchema = z.object({
	status: pullRequestChangedFileStatusSchema,
	oldPath: z.string(),
	newPath: z.string(),
	baseBlobId: z.string().optional(),
	headBlobId: z.string().optional(),
	additions: z.number().int().nonnegative(),
	deletions: z.number().int().nonnegative(),
	isBinary: z.boolean(),
})
export type PullRequestChangedFile = z.infer<
	typeof pullRequestChangedFileSchema
>

const pullRequestComparisonCommitSchema = z.object({
	sha: z.string(),
	shortSha: z.string(),
	summary: z.string(),
	author: z
		.object({
			name: z.string(),
			email: z.string(),
			date: z.coerce.date(),
		})
		.optional(),
	/** Absent when nothing has ever reported on the commit. */
	checksSummary: checksSummarySchema.optional(),
})

export const pullRequestComparisonSchema = z.object({
	baseSha: z.string(),
	headSha: z.string(),
	mergeBaseSha: z.string(),
	commits: z.array(pullRequestComparisonCommitSchema),
	commitsTruncated: z.boolean(),
	commitLimit: z.number().int().positive(),
	files: z.array(pullRequestChangedFileSchema),
	isTruncated: z.boolean(),
	fileLimit: z.number().int().positive(),
})
export type PullRequestComparison = z.infer<typeof pullRequestComparisonSchema>

const pullRequestDiffAnchorSchema = z.object({
	sha: z.string(),
	path: z.string(),
	line: z.number().int().positive(),
	side: z.enum(['left', 'right']),
})

const pullRequestDiffLineSchema = z.object({
	kind: z.enum(['addition', 'context', 'deletion']),
	content: z.string(),
	lightHtml: z.string().optional(),
	darkHtml: z.string().optional(),
	old: pullRequestDiffAnchorSchema.optional(),
	new: pullRequestDiffAnchorSchema.optional(),
})

const pullRequestDiffHunkSchema = z.object({
	header: z.string(),
	lines: z.array(pullRequestDiffLineSchema),
})

export const pullRequestFileDiffSchema = z.object({
	baseSha: z.string(),
	headSha: z.string(),
	mergeBaseSha: z.string(),
	file: pullRequestChangedFileSchema,
	language: z.string().optional(),
	hunks: z.array(pullRequestDiffHunkSchema),
	isTruncated: z.boolean(),
	patchLimitBytes: z.number().int().positive(),
})
export type PullRequestFileDiff = z.infer<typeof pullRequestFileDiffSchema>

export const pullRequestThreadAnchorInputSchema = z.object({
	path: z.string().trim().min(1).max(4096),
	side: pullRequestThreadSideSchema,
	line: z.number().int().positive(),
	anchorSha: pullRequestShaSchema,
	baseSha: pullRequestShaSchema,
	headSha: pullRequestShaSchema,
	lineExcerpt: z.string().max(4096),
})
export type PullRequestThreadAnchor = z.infer<
	typeof pullRequestThreadAnchorInputSchema
>

export const pullRequestCommentSchema = z.object({
	id: pullRequestCommentIdSchema,
	threadId: pullRequestThreadIdSchema,
	author: pullRequestActorSchema,
	body: z.string(),
	state: pullRequestCommentStateSchema,
	createdAt: z.coerce.date(),
	editedAt: z.coerce.date().optional(),
	sourceUrl: z.url().optional(),
})
export type PullRequestComment = z.infer<typeof pullRequestCommentSchema>

export const pullRequestThreadSchema = z.object({
	id: pullRequestThreadIdSchema,
	kind: pullRequestThreadKindSchema,
	anchor: pullRequestThreadAnchorInputSchema.optional(),
	resolved: z
		.object({
			at: z.coerce.date(),
			by: pullRequestActorSchema,
		})
		.optional(),
	outdated: z.boolean(),
	createdAt: z.coerce.date(),
	comments: z.array(pullRequestCommentSchema),
})
export type PullRequestThread = z.infer<typeof pullRequestThreadSchema>

export const pullRequestThreadViewerSchema = z.object({
	canComment: z.boolean(),
	canResolveAnyThread: z.boolean(),
	canDeleteAnyComment: z.boolean(),
})
export type PullRequestThreadViewer = z.infer<
	typeof pullRequestThreadViewerSchema
>

export const pullRequestReviewerRequestSchema = z.object({
	id: pullRequestReviewerRequestIdSchema,
	targetKind: pullRequestReviewerTargetKindSchema,
	reviewer: pullRequestActorSchema,
	requestedBy: pullRequestActorSchema.optional(),
	createdAt: z.coerce.date(),
})
export type PullRequestReviewerRequest = z.infer<
	typeof pullRequestReviewerRequestSchema
>

export const pullRequestReviewSchema = z.object({
	id: pullRequestReviewIdSchema,
	reviewer: pullRequestActorSchema,
	state: pullRequestReviewStateSchema,
	outcome: pullRequestReviewOutcomeSchema.optional(),
	body: z.string(),
	headSha: z.string(),
	submittedAt: z.coerce.date(),
	dismissedAt: z.coerce.date().optional(),
	dismissedBy: pullRequestActorSchema.optional(),
	sourceUrl: z.url().optional(),
})
export type PullRequestReview = z.infer<typeof pullRequestReviewSchema>

export const pullRequestEffectiveReviewStateSchema = z.object({
	reviewId: pullRequestReviewIdSchema,
	reviewer: pullRequestActorSchema,
	outcome: pullRequestReviewOutcomeSchema,
	headSha: z.string(),
	stale: z.boolean(),
	submittedAt: z.coerce.date(),
})
export type PullRequestEffectiveReviewState = z.infer<
	typeof pullRequestEffectiveReviewStateSchema
>

/**
 * The review a since-review comparison is anchored to. Trimmed to what the
 * comparison itself has to name: the body and the dismissal record belong to
 * the review history, not to the diff header.
 */
const pullRequestReviewComparisonContextSchema = z.object({
	id: pullRequestReviewIdSchema,
	reviewer: pullRequestActorSchema,
	state: z.enum(['submitted', 'dismissed']),
	outcome: pullRequestReviewOutcomeSchema.optional(),
	headSha: z.string(),
	submittedAt: z.coerce.date(),
})
export type PullRequestReviewComparisonContext = z.infer<
	typeof pullRequestReviewComparisonContextSchema
>

const pullRequestReviewComparisonBaseSchema = z.object({
	review: pullRequestReviewComparisonContextSchema,
	/**
	 * The full pull request pair. Threads opened while reading a since-review
	 * comparison anchor to it rather than to the pair being displayed, or the
	 * normal files view would treat them as outdated the moment they are made.
	 */
	canonicalBaseSha: z.string(),
	currentHeadSha: z.string(),
})

/**
 * What arrived after a review, or why nothing can be shown. The exceptional
 * states are named rather than inferred: two different commits can legitimately
 * produce an empty file list, and a reviewed commit the repository no longer
 * holds is a fact about history rather than a failure of the request.
 */
export const pullRequestReviewComparisonSchema = z.discriminatedUnion(
	'status',
	[
		pullRequestReviewComparisonBaseSchema.extend({
			status: z.literal('ready'),
			/** The reviewed commit is no longer an ancestor of the current head. */
			historiesDiverged: z.boolean(),
			comparison: pullRequestComparisonSchema,
		}),
		pullRequestReviewComparisonBaseSchema.extend({
			status: z.literal('nothing_new'),
		}),
		pullRequestReviewComparisonBaseSchema.extend({
			status: z.literal('review_head_unavailable'),
		}),
	]
)
export type PullRequestReviewComparison = z.infer<
	typeof pullRequestReviewComparisonSchema
>

export const pullRequestPendingReviewSchema = z.object({
	id: pullRequestReviewIdSchema,
	headSha: z.string(),
	commentCount: z.number().int().nonnegative(),
})
export type PullRequestPendingReview = z.infer<
	typeof pullRequestPendingReviewSchema
>

export const pullRequestReviewerCandidateSchema = z.object({
	userId: z.uuid().brand<'user_id'>(),
	username: z.string().min(1),
})
export type PullRequestReviewerCandidate = z.infer<
	typeof pullRequestReviewerCandidateSchema
>

export const pullRequestReviewSummarySchema = z.object({
	requestedCount: z.number().int().nonnegative(),
	approvedCount: z.number().int().nonnegative(),
	changeRequestCount: z.number().int().nonnegative(),
	staleCount: z.number().int().nonnegative(),
})
export type PullRequestReviewSummary = z.infer<
	typeof pullRequestReviewSummarySchema
>

export const pullRequestReviewViewerSchema = z.object({
	canSubmitReview: z.boolean(),
	canRequestReviewers: z.boolean(),
	canRemoveReviewerRequests: z.boolean(),
})
export type PullRequestReviewViewer = z.infer<
	typeof pullRequestReviewViewerSchema
>

/**
 * Every reason a merge can be refused except `queue_paused` itself. A paused
 * entry reports why its own evaluation failed, and that answer can never be
 * "the entry is paused", so the nesting stays one level deep and the union
 * stays non-recursive.
 */
const mergeQueuePauseReasonOptions = [
	z.object({
		code: z.literal('insufficient_permission'),
		requiredRole: z.literal('write'),
		actualRole: repositoryViewerRoleSchema.optional(),
	}),
	z.object({
		code: z.literal('pull_request_not_open'),
		state: pullRequestStateSchema,
	}),
	z.object({ code: z.literal('draft_pull_request') }),
	z.object({
		code: z.literal('read_only_mirror'),
		authority: z.literal('github'),
	}),
	z.object({
		code: z.literal('stale_refs'),
		expectedBaseSha: z.string().optional(),
		actualBaseSha: z.string(),
		expectedHeadSha: z.string().optional(),
		actualHeadSha: z.string(),
	}),
	z.object({
		code: z.literal('merge_conflict'),
		baseSha: z.string(),
		headSha: z.string(),
	}),
	z.object({
		code: z.literal('merge_strategy_unavailable'),
		strategy: mergeStrategySchema,
		reason: mergeStrategyUnavailableReasonSchema,
	}),
	// Git storage could not say what each method would do, which during a
	// rolling deployment means it is old enough not to know about methods at
	// all. Merging anyway would let it quietly make a merge commit for a
	// requested squash or rebase.
	z.object({ code: z.literal('merge_strategies_unsupported') }),
	z.object({
		code: z.literal('approvals_required'),
		required: z.number().int().positive(),
		approved: z.number().int().nonnegative(),
		/** Approvals the rule discounted because the head moved past them. */
		staleApprovals: z.number().int().nonnegative(),
	}),
	z.object({
		code: z.literal('changes_requested'),
		reviewers: z.array(pullRequestEffectiveReviewStateSchema),
	}),
	z.object({
		code: z.literal('checks_pending'),
		contexts: z.array(requiredContextEvaluationSchema),
	}),
	z.object({
		code: z.literal('checks_failed'),
		contexts: z.array(requiredContextEvaluationSchema),
	}),
	z.object({
		code: z.literal('threads_unresolved'),
		count: z.number().int().positive(),
	}),
	z.object({ code: z.literal('merge_queue_required') }),
	z.object({
		code: z.literal('already_queued'),
		state: mergeQueueStateSchema,
	}),
	z.object({
		code: z.literal('not_queue_head'),
		position: z.number().int().positive(),
	}),
	z.object({ code: z.literal('repository_merge_in_progress') }),
] as const

export const mergeQueuePauseReasonSchema = z.discriminatedUnion(
	'code',
	mergeQueuePauseReasonOptions
)
export type MergeQueuePauseReason = z.infer<typeof mergeQueuePauseReasonSchema>

export const mergeBlockingReasonSchema = z.discriminatedUnion('code', [
	...mergeQueuePauseReasonOptions,
	z.object({
		code: z.literal('queue_paused'),
		reasons: z.array(mergeQueuePauseReasonSchema),
	}),
])
export type MergeBlockingReason = z.infer<typeof mergeBlockingReasonSchema>

/**
 * The verdict on merging as of this evaluation. `canBypass` is true only when
 * the viewer holds the role the rule configured and every current blocker is
 * one policy is allowed to waive; permission, state, freshness, conflict and
 * queue ordering never are.
 */
export const mergeRequirementsSchema = z.object({
	eligible: z.boolean(),
	evaluatedBaseSha: z.string().optional(),
	evaluatedHeadSha: z.string().optional(),
	/**
	 * What each strategy could do with these branches. Absent when the evaluation
	 * never reached Git — a closed pull request or a mirror Tessera may not write
	 * to has no live pair of tips to judge any strategy against.
	 */
	strategyAvailability: z.array(mergeStrategyAvailabilitySchema).optional(),
	rule: z
		.object({
			id: branchProtectionRuleIdSchema,
			version: z.number().int().positive(),
			targetBranch: z.string(),
		})
		.optional(),
	canBypass: z.boolean(),
	reasons: z.array(mergeBlockingReasonSchema),
})
export type MergeRequirements = z.infer<typeof mergeRequirementsSchema>

export const mergeQueueEntrySchema = z.object({
	entryId: mergeQueueEntryIdSchema,
	state: mergeQueueStateSchema,
	/** The method this entry will merge by, fixed when it was queued. */
	strategy: mergeStrategySchema,
	/** Place among runnable entries, counted fresh; absent when not runnable. */
	position: z.number().int().positive().optional(),
	blockingReasons: z.array(mergeQueuePauseReasonSchema).optional(),
	enqueuedAt: z.coerce.date(),
	stateChangedAt: z.coerce.date(),
})
export type MergeQueueEntry = z.infer<typeof mergeQueueEntrySchema>

export const mergeQueueStatusSchema = z.object({
	/** Absent when this pull request holds no active entry. */
	entry: mergeQueueEntrySchema.optional(),
	/** Runnable entries in the repository, paused ones excluded. */
	runnableCount: z.number().int().nonnegative(),
})
export type MergeQueueStatus = z.infer<typeof mergeQueueStatusSchema>

export const pullRequestListItemSchema = pullRequestSchema.extend({
	reviewSummary: pullRequestReviewSummarySchema,
	/** Absent when the head commit has no result to roll up yet. */
	checksSummary: checksSummarySchema.optional(),
})
export type PullRequestListItem = z.infer<typeof pullRequestListItemSchema>

const repositoryPullRequestsInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})

export const createPullRequestInputSchema = repositoryPullRequestsInputSchema
	.extend({
		sourceBranch: z.string().trim().min(1).max(255),
		targetBranch: z.string().trim().min(1).max(255),
		// The title becomes a squash commit's subject, which is one line.
		title: mergeCommitTitleSchema,
		body: commitSafeBodySchema.optional(),
	})
	.refine(input => input.sourceBranch !== input.targetBranch, {
		message: 'The source and target branches must be different',
		path: ['targetBranch'],
	})
export type CreatePullRequestInput = z.input<
	typeof createPullRequestInputSchema
>
export type ParsedCreatePullRequestInput = z.infer<
	typeof createPullRequestInputSchema
>

export const listPullRequestsInputSchema =
	repositoryPullRequestsInputSchema.extend({
		state: pullRequestStateSchema.optional(),
	})
export type ListPullRequestsInput = z.input<typeof listPullRequestsInputSchema>
export type ParsedListPullRequestsInput = z.infer<
	typeof listPullRequestsInputSchema
>

export const getPullRequestInputSchema =
	repositoryPullRequestsInputSchema.extend({
		number: z.coerce.number().int().positive(),
	})
export type GetPullRequestInput = z.input<typeof getPullRequestInputSchema>
export type ParsedGetPullRequestInput = z.infer<
	typeof getPullRequestInputSchema
>

export const getPullRequestFileDiffInputSchema =
	getPullRequestInputSchema.extend({
		path: z.string().trim().min(1).max(4096),
		expectedBaseSha: pullRequestShaSchema,
		expectedHeadSha: pullRequestShaSchema,
	})
export type GetPullRequestFileDiffInput = z.input<
	typeof getPullRequestFileDiffInputSchema
>
export type ParsedGetPullRequestFileDiffInput = z.infer<
	typeof getPullRequestFileDiffInputSchema
>

export const getPullRequestReviewComparisonInputSchema =
	getPullRequestInputSchema.extend({ reviewId: pullRequestReviewIdSchema })
export type GetPullRequestReviewComparisonInput = z.input<
	typeof getPullRequestReviewComparisonInputSchema
>
export type ParsedGetPullRequestReviewComparisonInput = z.infer<
	typeof getPullRequestReviewComparisonInputSchema
>

/**
 * The commit the caller believes the pull request points at. Results are read
 * for that commit rather than whichever one the head has since become, so rows
 * a client already holds can never be rendered under a newer head's rollup.
 */
export const listPullRequestChecksInputSchema =
	getPullRequestInputSchema.extend({ expectedHeadSha: pullRequestShaSchema })
export type ListPullRequestChecksInput = z.input<
	typeof listPullRequestChecksInputSchema
>
export type ParsedListPullRequestChecksInput = z.infer<
	typeof listPullRequestChecksInputSchema
>

/**
 * The strategy is part of the request rather than a repository setting, and it
 * is discriminated so the options only one of them takes cannot be sent with the
 * others. A squash title and body are optional: the server derives both from the
 * pull request when the caller does not override them, which is also the only
 * safe default — client-supplied text is validated, never trusted.
 */
function withMergeStrategy<Shape extends z.ZodRawShape>(
	base: z.ZodObject<Shape>
) {
	// The squash fields are refused rather than ignored on the strategies that
	// write no message of their own. Zod would otherwise strip them, and a client
	// sending a title it believed would be used has misunderstood something worth
	// being told about.
	const withoutSquashMessage = {
		squashTitle: z.never().optional(),
		squashBody: z.never().optional(),
	}

	return z.discriminatedUnion('strategy', [
		base.extend({
			strategy: z.literal('merge_commit'),
			...withoutSquashMessage,
		}),
		base.extend({ strategy: z.literal('rebase'), ...withoutSquashMessage }),
		base.extend({
			strategy: z.literal('fast_forward'),
			...withoutSquashMessage,
		}),
		base.extend({
			strategy: z.literal('squash'),
			squashTitle: mergeCommitTitleSchema.optional(),
			squashBody: commitSafeBodySchema.optional(),
		}),
	])
}

export const mergePullRequestInputSchema = withMergeStrategy(
	getPullRequestInputSchema.extend({
		expectedBaseSha: pullRequestShaSchema,
		expectedHeadSha: pullRequestShaSchema,
		/**
		 * Present only when the caller is deliberately merging past waivable
		 * requirements. The reason is mandatory because it is what the audit row
		 * carries; the server still decides whether the role and the blockers allow
		 * it.
		 */
		bypass: z.object({ reason: z.string().trim().min(1).max(1000) }).optional(),
	})
)
export type MergePullRequestInput = z.input<typeof mergePullRequestInputSchema>
export type ParsedMergePullRequestInput = z.infer<
	typeof mergePullRequestInputSchema
>

/**
 * The strategy alone, as the parts of the system that only carry it see it.
 * Discriminated like the inputs it is taken from, so the message fields cannot
 * travel with a strategy that writes no message.
 */
export type MergeStrategySelection =
	| { strategy: 'merge_commit' }
	| { strategy: 'rebase' }
	| { strategy: 'fast_forward' }
	| { strategy: 'squash'; squashBody?: string; squashTitle?: string }

/**
 * Blocked is a result, not a failure: the caller asked whether this merge may
 * happen and got a complete answer. Only authentication, authorization and
 * not-found stay errors.
 */
export const mergePullRequestResultSchema = z.discriminatedUnion('status', [
	z.object({ status: z.literal('merged'), pullRequest: pullRequestSchema }),
	z.object({
		status: z.literal('blocked'),
		requirements: mergeRequirementsSchema,
	}),
])
export type MergePullRequestResult = z.infer<
	typeof mergePullRequestResultSchema
>

/**
 * The strategy is locked when the entry is created. The queue decides when a
 * pull request merges, not how: an entry that could change method between being
 * queued and being run would merge by a method nobody chose.
 */
export const joinMergeQueueInputSchema = withMergeStrategy(
	getPullRequestInputSchema
)
export type JoinMergeQueueInput = z.input<typeof joinMergeQueueInputSchema>
export type ParsedJoinMergeQueueInput = z.infer<
	typeof joinMergeQueueInputSchema
>

export const leaveMergeQueueInputSchema = getPullRequestInputSchema
export type LeaveMergeQueueInput = z.input<typeof leaveMergeQueueInputSchema>
export type ParsedLeaveMergeQueueInput = z.infer<
	typeof leaveMergeQueueInputSchema
>

export const retryMergeQueueEntryInputSchema = getPullRequestInputSchema
export type RetryMergeQueueEntryInput = z.input<
	typeof retryMergeQueueEntryInputSchema
>
export type ParsedRetryMergeQueueEntryInput = z.infer<
	typeof retryMergeQueueEntryInputSchema
>

export const editPullRequestInputSchema = getPullRequestInputSchema
	.extend({
		title: mergeCommitTitleSchema.optional(),
		body: commitSafeBodySchema.optional(),
	})
	.refine(input => input.title !== undefined || input.body !== undefined, {
		message: 'At least one editable field is required',
	})
export type EditPullRequestInput = z.input<typeof editPullRequestInputSchema>
export type ParsedEditPullRequestInput = z.infer<
	typeof editPullRequestInputSchema
>

const pullRequestCommentBodySchema = z.string().trim().min(1).max(65_536)

const pullRequestReviewMarkerSchema = z.object({
	expectedHeadSha: pullRequestShaSchema,
})

export const listPullRequestThreadsInputSchema =
	getPullRequestInputSchema.extend({
		path: z.string().trim().min(1).max(4096).optional(),
	})
export type ListPullRequestThreadsInput = z.input<
	typeof listPullRequestThreadsInputSchema
>
export type ParsedListPullRequestThreadsInput = z.infer<
	typeof listPullRequestThreadsInputSchema
>

export const createPullRequestThreadInputSchema =
	getPullRequestInputSchema.extend({
		body: pullRequestCommentBodySchema,
		anchor: pullRequestThreadAnchorInputSchema.optional(),
		review: pullRequestReviewMarkerSchema.optional(),
	})
export type CreatePullRequestThreadInput = z.input<
	typeof createPullRequestThreadInputSchema
>
export type ParsedCreatePullRequestThreadInput = z.infer<
	typeof createPullRequestThreadInputSchema
>

export const replyPullRequestThreadInputSchema =
	getPullRequestInputSchema.extend({
		threadId: pullRequestThreadIdSchema,
		body: pullRequestCommentBodySchema,
		review: pullRequestReviewMarkerSchema.optional(),
	})
export type ReplyPullRequestThreadInput = z.input<
	typeof replyPullRequestThreadInputSchema
>
export type ParsedReplyPullRequestThreadInput = z.infer<
	typeof replyPullRequestThreadInputSchema
>

export const editPullRequestCommentInputSchema =
	getPullRequestInputSchema.extend({
		commentId: pullRequestCommentIdSchema,
		body: pullRequestCommentBodySchema,
	})
export type EditPullRequestCommentInput = z.input<
	typeof editPullRequestCommentInputSchema
>
export type ParsedEditPullRequestCommentInput = z.infer<
	typeof editPullRequestCommentInputSchema
>

export const deletePullRequestCommentInputSchema =
	getPullRequestInputSchema.extend({
		commentId: pullRequestCommentIdSchema,
	})
export type DeletePullRequestCommentInput = z.input<
	typeof deletePullRequestCommentInputSchema
>
export type ParsedDeletePullRequestCommentInput = z.infer<
	typeof deletePullRequestCommentInputSchema
>

export const resolvePullRequestThreadInputSchema =
	getPullRequestInputSchema.extend({
		threadId: pullRequestThreadIdSchema,
	})
export type ResolvePullRequestThreadInput = z.input<
	typeof resolvePullRequestThreadInputSchema
>
export type ParsedResolvePullRequestThreadInput = z.infer<
	typeof resolvePullRequestThreadInputSchema
>

export const requestPullRequestReviewerInputSchema =
	getPullRequestInputSchema.extend({
		reviewerUsername: z.string().trim().min(1),
	})
export type RequestPullRequestReviewerInput = z.input<
	typeof requestPullRequestReviewerInputSchema
>
export type ParsedRequestPullRequestReviewerInput = z.infer<
	typeof requestPullRequestReviewerInputSchema
>

export const submitPullRequestReviewInputSchema =
	getPullRequestInputSchema.extend({
		outcome: pullRequestReviewOutcomeSchema,
		body: z.string().max(65_536).optional(),
		expectedHeadSha: pullRequestShaSchema,
	})
export type SubmitPullRequestReviewInput = z.input<
	typeof submitPullRequestReviewInputSchema
>
export type ParsedSubmitPullRequestReviewInput = z.infer<
	typeof submitPullRequestReviewInputSchema
>

export const pullRequestsContract = {
	create: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls',
		})
		.input(createPullRequestInputSchema)
		.output(pullRequestSchema),
	list: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls',
		})
		.input(listPullRequestsInputSchema)
		.output(
			z.object({
				pullRequests: z.array(pullRequestListItemSchema),
				authority: pullRequestAuthoritySchema,
				viewerRole: repositoryViewerRoleSchema,
			})
		),
	get: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}',
		})
		.input(getPullRequestInputSchema)
		.output(
			z.object({
				pullRequest: pullRequestSchema,
				events: z.array(pullRequestEventSchema),
				reviewerRequests: z.array(pullRequestReviewerRequestSchema),
				reviews: z.array(pullRequestReviewSchema),
				effectiveReviewStates: z.array(pullRequestEffectiveReviewStateSchema),
				checksSummary: checksSummarySchema.optional(),
				viewerPendingReview: pullRequestPendingReviewSchema.optional(),
				reviewerCandidates: z.array(pullRequestReviewerCandidateSchema),
				viewer: pullRequestReviewViewerSchema,
				mergeQueue: mergeQueueStatusSchema,
				authority: pullRequestAuthoritySchema,
				viewerRole: repositoryViewerRoleSchema,
			})
		),
	comparison: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/comparison',
		})
		.input(getPullRequestInputSchema)
		.output(pullRequestComparisonSchema),
	reviewComparison: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/reviews/{reviewId}/comparison',
		})
		.input(getPullRequestReviewComparisonInputSchema)
		.output(pullRequestReviewComparisonSchema),
	fileDiff: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/files',
		})
		.input(getPullRequestFileDiffInputSchema)
		.output(pullRequestFileDiffSchema),
	listChecks: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/checks',
		})
		.input(listPullRequestChecksInputSchema)
		.output(checksListSchema),
	edit: oc
		.route({
			method: 'PATCH',
			path: '/repositories/{username}/{slug}/pulls/{number}',
		})
		.input(editPullRequestInputSchema)
		.output(pullRequestSchema),
	close: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/close',
		})
		.input(getPullRequestInputSchema)
		.output(pullRequestSchema),
	reopen: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/reopen',
		})
		.input(getPullRequestInputSchema)
		.output(pullRequestSchema),
	merge: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/merge',
		})
		.input(mergePullRequestInputSchema)
		.output(mergePullRequestResultSchema),
	getMergeRequirements: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/merge-requirements',
		})
		.input(getPullRequestInputSchema)
		.output(mergeRequirementsSchema),
	joinMergeQueue: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/merge-queue',
		})
		.input(joinMergeQueueInputSchema)
		.output(mergeQueueStatusSchema),
	leaveMergeQueue: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/pulls/{number}/merge-queue',
		})
		.input(leaveMergeQueueInputSchema)
		.output(mergeQueueStatusSchema),
	retryMergeQueueEntry: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/merge-queue/retry',
		})
		.input(retryMergeQueueEntryInputSchema)
		.output(mergeQueueStatusSchema),
	listThreads: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/threads',
		})
		.input(listPullRequestThreadsInputSchema)
		.output(
			z.object({
				threads: z.array(pullRequestThreadSchema),
				comparison: z.object({
					baseSha: z.string(),
					headSha: z.string(),
				}),
				viewer: pullRequestThreadViewerSchema,
			})
		),
	createThread: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/threads',
		})
		.input(createPullRequestThreadInputSchema)
		.output(pullRequestThreadSchema),
	replyThread: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/threads/{threadId}/comments',
		})
		.input(replyPullRequestThreadInputSchema)
		.output(pullRequestThreadSchema),
	editComment: oc
		.route({
			method: 'PATCH',
			path: '/repositories/{username}/{slug}/pulls/{number}/comments/{commentId}',
		})
		.input(editPullRequestCommentInputSchema)
		.output(pullRequestCommentSchema),
	deleteComment: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/pulls/{number}/comments/{commentId}',
		})
		.input(deletePullRequestCommentInputSchema)
		.output(z.object({ threadDeleted: z.boolean() })),
	resolveThread: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/threads/{threadId}/resolve',
		})
		.input(resolvePullRequestThreadInputSchema)
		.output(pullRequestThreadSchema),
	unresolveThread: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/threads/{threadId}/unresolve',
		})
		.input(resolvePullRequestThreadInputSchema)
		.output(pullRequestThreadSchema),
	requestReviewer: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/reviewers',
		})
		.input(requestPullRequestReviewerInputSchema)
		.output(pullRequestReviewerRequestSchema),
	removeReviewerRequest: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/pulls/{number}/reviewers/{reviewerUsername}',
		})
		.input(requestPullRequestReviewerInputSchema)
		.output(z.object({ removed: z.boolean() })),
	submitReview: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/pulls/{number}/reviews',
		})
		.input(submitPullRequestReviewInputSchema)
		.output(pullRequestReviewSchema),
	discardPendingReview: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/pulls/{number}/reviews/pending',
		})
		.input(getPullRequestInputSchema)
		.output(z.object({ discarded: z.boolean() })),
}

import { oc } from '@orpc/contract'
import { z } from 'zod'
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

export const pullRequestStateSchema = z.enum(['open', 'closed', 'merged'])
export type PullRequestState = z.infer<typeof pullRequestStateSchema>

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
 * stays readable in history.
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
	mergeCommitSha: z.string().optional(),
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
	outcome: pullRequestReviewOutcomeSchema,
	headSha: z.string(),
})

const pullRequestEventPayloadSchema = z.union([
	pullRequestThreadEventPayloadSchema,
	pullRequestReviewerEventPayloadSchema,
	pullRequestReviewEventPayloadSchema,
])

export const pullRequestEventSchema = z.object({
	id: z.uuid().brand<'pull_request_event_id'>(),
	pullRequestId: pullRequestIdSchema,
	provider: pullRequestProviderSchema,
	actorUserId: z.uuid().brand<'user_id'>().optional(),
	actorUsername: z.string().min(1),
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
	outcome: pullRequestReviewOutcomeSchema,
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

export const pullRequestListItemSchema = pullRequestSchema.extend({
	reviewSummary: pullRequestReviewSummarySchema,
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
		title: z.string().trim().min(1).max(256),
		body: z.string().max(65_536).optional(),
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

export const mergePullRequestInputSchema = getPullRequestInputSchema.extend({
	expectedBaseSha: pullRequestShaSchema,
	expectedHeadSha: pullRequestShaSchema,
})
export type MergePullRequestInput = z.input<typeof mergePullRequestInputSchema>
export type ParsedMergePullRequestInput = z.infer<
	typeof mergePullRequestInputSchema
>

export const editPullRequestInputSchema = getPullRequestInputSchema
	.extend({
		title: z.string().trim().min(1).max(256).optional(),
		body: z.string().max(65_536).optional(),
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
				viewerPendingReview: pullRequestPendingReviewSchema.optional(),
				reviewerCandidates: z.array(pullRequestReviewerCandidateSchema),
				viewer: pullRequestReviewViewerSchema,
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
	fileDiff: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/pulls/{number}/files',
		})
		.input(getPullRequestFileDiffInputSchema)
		.output(pullRequestFileDiffSchema),
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
		.output(pullRequestSchema),
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

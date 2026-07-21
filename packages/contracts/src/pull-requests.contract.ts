import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
	repositorySlugSchema,
	repositoryViewerRoleSchema,
} from './repositories.contract'

export const PULL_REQUEST_STALE_COMPARISON_MESSAGE =
	'The source or target branch changed. Refresh the pull request and try again.'

export const pullRequestIdSchema = z.uuid().brand<'pull_request_id'>()
export type PullRequestId = z.infer<typeof pullRequestIdSchema>

export const pullRequestStateSchema = z.enum(['open', 'closed', 'merged'])
export type PullRequestState = z.infer<typeof pullRequestStateSchema>

export const pullRequestEventTypeSchema = z.enum([
	'opened',
	'edited',
	'closed',
	'reopened',
	'merged',
])
export type PullRequestEventType = z.infer<typeof pullRequestEventTypeSchema>

export const pullRequestSchema = z.object({
	id: pullRequestIdSchema,
	repositoryId: z.uuid().brand<'repository_id'>(),
	number: z.number().int().positive(),
	authorUserId: z.uuid().brand<'user_id'>(),
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
})
export type PullRequest = z.infer<typeof pullRequestSchema>

export const pullRequestEventSchema = z.object({
	id: z.uuid().brand<'pull_request_event_id'>(),
	pullRequestId: pullRequestIdSchema,
	actorUserId: z.uuid().brand<'user_id'>(),
	type: pullRequestEventTypeSchema,
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
		expectedBaseSha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
		expectedHeadSha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
	})
export type GetPullRequestFileDiffInput = z.input<
	typeof getPullRequestFileDiffInputSchema
>
export type ParsedGetPullRequestFileDiffInput = z.infer<
	typeof getPullRequestFileDiffInputSchema
>

export const mergePullRequestInputSchema = getPullRequestInputSchema.extend({
	expectedBaseSha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
	expectedHeadSha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
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
				pullRequests: z.array(pullRequestSchema),
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
}

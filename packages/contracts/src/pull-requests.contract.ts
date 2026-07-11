import { oc } from '@orpc/contract'
import { z } from 'zod'
import { repositorySlugSchema } from './repositories.contract'

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
		.output(z.object({ pullRequests: z.array(pullRequestSchema) })),
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
			})
		),
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
}

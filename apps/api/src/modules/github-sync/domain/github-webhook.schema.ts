import { z } from 'zod'

const gitHubActorSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	login: z.string().min(1),
	type: z.string().min(1),
	avatar_url: z.url().optional(),
	html_url: z.url().optional(),
})

const gitHubTeamSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	slug: z.string().min(1),
	name: z.string().min(1),
	html_url: z.url().optional(),
})

const gitHubInstallationSchema = z.object({
	id: z.number().int().positive(),
	target_type: z.enum(['User', 'Organization']).optional(),
	account: gitHubActorSchema.nullish(),
	suspended_at: z.coerce.date().nullish(),
})

const gitHubRepositorySchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
})

const gitHubInstallationRepositorySchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
})

const gitHubPullRequestSchema = z.object({
	node_id: z.string().min(1),
	number: z.number().int().positive(),
})

const gitHubIssueSchema = z.object({
	node_id: z.string().min(1).optional(),
	number: z.number().int().positive(),
	pull_request: z.object({ html_url: z.url().optional() }).optional(),
})

const gitHubDiffSideSchema = z.enum(['LEFT', 'RIGHT'])

const gitHubCommentSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	html_url: z.url().optional(),
	user: gitHubActorSchema.nullish(),
	pull_request_review_id: z.number().int().positive().nullish(),
	in_reply_to_id: z.number().int().positive().nullish(),
	subject_type: z.enum(['line', 'file']).nullish(),
	path: z.string().min(1).nullish(),
	side: gitHubDiffSideSchema.nullish(),
	line: z.number().int().nullish(),
	original_line: z.number().int().nullish(),
	start_side: gitHubDiffSideSchema.nullish(),
	start_line: z.number().int().nullish(),
	original_start_line: z.number().int().nullish(),
	commit_id: z.string().min(1).nullish(),
	original_commit_id: z.string().min(1).nullish(),
	created_at: z.coerce.date().optional(),
	updated_at: z.coerce.date().optional(),
})

const gitHubReviewSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	html_url: z.url().optional(),
	user: gitHubActorSchema.nullish(),
	state: z.string().min(1).optional(),
	commit_id: z.string().min(1).nullish(),
	submitted_at: z.coerce.date().nullish(),
})

const gitHubReviewThreadSchema = z.object({
	node_id: z.string().min(1).optional(),
	comments: z
		.array(
			z.object({
				id: z.number().int().positive(),
				node_id: z.string().min(1),
			})
		)
		.optional(),
})

export const gitHubWebhookPayloadSchema = z.object({
	action: z.string().optional(),
	installation: gitHubInstallationSchema.optional(),
	repository: gitHubRepositorySchema.optional(),
	sender: gitHubActorSchema.optional(),
	pull_request: gitHubPullRequestSchema.optional(),
	issue: gitHubIssueSchema.optional(),
	comment: gitHubCommentSchema.optional(),
	review: gitHubReviewSchema.optional(),
	thread: gitHubReviewThreadSchema.optional(),
	assignee: gitHubActorSchema.optional(),
	requested_reviewer: gitHubActorSchema.optional(),
	requested_team: gitHubTeamSchema.optional(),
	label: z
		.object({
			node_id: z.string().min(1),
			name: z.string().min(1),
		})
		.optional(),
	repositories: z.array(gitHubInstallationRepositorySchema).optional(),
	repositories_added: z.array(gitHubInstallationRepositorySchema).optional(),
	repositories_removed: z.array(gitHubInstallationRepositorySchema).optional(),
})

export type GitHubWebhookPayload = z.infer<typeof gitHubWebhookPayloadSchema>
export type GitHubWebhookActor = z.infer<typeof gitHubActorSchema>
export type GitHubWebhookTeam = z.infer<typeof gitHubTeamSchema>
export type GitHubWebhookInstallation = z.infer<typeof gitHubInstallationSchema>

export type GitHubWebhookTargetResourceKind =
	| 'pull_request'
	| 'issue_comment'
	| 'review_comment'
	| 'review'
	| 'review_thread'

/** `null` accepts every action GitHub sends for the event. */
const gitHubWebhookEventActions: Record<string, readonly string[] | null> = {
	installation: null,
	installation_repositories: null,
	repository: null,
	push: null,
	create: null,
	delete: null,
	pull_request: null,
	issue_comment: ['created', 'edited', 'deleted'],
	pull_request_review: ['submitted', 'edited', 'dismissed'],
	pull_request_review_comment: ['created', 'edited', 'deleted'],
	pull_request_review_thread: ['resolved', 'unresolved'],
}

export const GITHUB_CONVERSATION_WEBHOOK_EVENTS = [
	'pull_request',
	'issue_comment',
	'pull_request_review',
	'pull_request_review_comment',
	'pull_request_review_thread',
] as const

export function parseGitHubWebhookPayload(
	rawBody: Buffer
): GitHubWebhookPayload {
	return gitHubWebhookPayloadSchema.parse(JSON.parse(rawBody.toString('utf8')))
}

export function isSupportedGitHubWebhookEvent({
	action,
	eventName,
}: {
	action?: string
	eventName: string
}): boolean {
	if (!Object.hasOwn(gitHubWebhookEventActions, eventName)) return false

	const actions = gitHubWebhookEventActions[eventName]

	if (!actions) return true

	return Boolean(action && actions.includes(action))
}

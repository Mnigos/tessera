import { z } from 'zod'

const gitHubActorSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	login: z.string().min(1),
	type: z.string().min(1),
	avatar_url: z.url().optional(),
	html_url: z.url().optional(),
})

const gitHubInstallationSchema = z.object({
	id: z.number().int().positive(),
	target_type: z.enum(['User', 'Organization']).optional(),
	account: gitHubActorSchema,
})

const gitHubRepositorySchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	name: z.string().min(1),
	full_name: z.string().min(1),
	html_url: z.url(),
	clone_url: z.url(),
	default_branch: z.string().min(1),
	owner: gitHubActorSchema,
})

const gitHubInstallationRepositorySchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
})

const gitHubPullRequestRefSchema = z.object({
	ref: z.string().min(1),
	sha: z.string().min(1),
	repo: gitHubRepositorySchema.nullable(),
})

const gitHubPullRequestSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	number: z.number().int().positive(),
	html_url: z.url(),
	title: z.string(),
	body: z.string().nullable(),
	state: z.enum(['open', 'closed']),
	draft: z.boolean().nullable(),
	user: gitHubActorSchema,
	merged: z.boolean().optional(),
	merged_by: gitHubActorSchema.nullable().optional(),
	merge_commit_sha: z.string().nullable(),
	created_at: z.coerce.date(),
	updated_at: z.coerce.date(),
	closed_at: z.coerce.date().nullable(),
	merged_at: z.coerce.date().nullable(),
	head: gitHubPullRequestRefSchema,
	base: gitHubPullRequestRefSchema,
})

export const gitHubWebhookPayloadSchema = z.object({
	action: z.string().optional(),
	installation: gitHubInstallationSchema.optional(),
	repository: gitHubRepositorySchema.optional(),
	sender: gitHubActorSchema.optional(),
	pull_request: gitHubPullRequestSchema.optional(),
	assignee: gitHubActorSchema.optional(),
	requested_reviewer: gitHubActorSchema.optional(),
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
export type GitHubWebhookPullRequest = z.infer<typeof gitHubPullRequestSchema>

export function parseGitHubWebhookPayload(
	rawBody: Buffer
): GitHubWebhookPayload {
	return gitHubWebhookPayloadSchema.parse(JSON.parse(rawBody.toString('utf8')))
}

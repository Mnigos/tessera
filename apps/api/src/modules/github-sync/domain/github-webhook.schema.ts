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
export type GitHubWebhookInstallation = z.infer<typeof gitHubInstallationSchema>

export function parseGitHubWebhookPayload(
	rawBody: Buffer
): GitHubWebhookPayload {
	return gitHubWebhookPayloadSchema.parse(JSON.parse(rawBody.toString('utf8')))
}

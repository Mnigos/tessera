import { oc } from '@orpc/contract'
import { z } from 'zod'
import { repositorySlugSchema } from './repositories.contract'

export const githubImportRepositoryVisibilitySchema = z.enum([
	'public',
	'private',
	'internal',
])
export type GitHubImportRepositoryVisibility = z.infer<
	typeof githubImportRepositoryVisibilitySchema
>

export const githubImportRepositorySchema = z.object({
	githubId: z.string().regex(/^\d+$/),
	ownerLogin: z.string(),
	name: z.string(),
	fullName: z.string(),
	visibility: githubImportRepositoryVisibilitySchema,
	defaultBranch: z.string(),
	pushedAt: z.coerce.date().optional(),
	githubUrl: z.url({ protocol: /^https?$/, hostname: z.regexes.domain }),
})
export type GitHubImportRepository = z.infer<
	typeof githubImportRepositorySchema
>

export const githubRepositoryImportStatusSchema = z.enum([
	'pending',
	'running',
	'succeeded',
	'failed',
])
export type GitHubRepositoryImportStatus = z.infer<
	typeof githubRepositoryImportStatusSchema
>

export const githubRepositoryImportSchema = z.object({
	id: z.uuid().brand<'repository_import_id'>(),
	repositoryId: z.uuid().brand<'repository_id'>().optional(),
	provider: z.literal('github'),
	targetName: z.string(),
	targetSlug: repositorySlugSchema,
	source: githubImportRepositorySchema,
	status: githubRepositoryImportStatusSchema,
	failureReason: z.string().optional(),
	startedAt: z.coerce.date().optional(),
	completedAt: z.coerce.date().optional(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type GitHubRepositoryImport = z.infer<
	typeof githubRepositoryImportSchema
>

export const createGitHubRepositoryImportInputSchema = z.object({
	githubId: z.string().regex(/^\d+$/),
	targetSlug: z.string().trim().min(1).max(64).optional(),
})
export type CreateGitHubRepositoryImportInput = z.input<
	typeof createGitHubRepositoryImportInputSchema
>

export const getGitHubRepositoryImportInputSchema = z.object({
	id: z.uuid().brand<'repository_import_id'>(),
})
export type GetGitHubRepositoryImportInput = z.input<
	typeof getGitHubRepositoryImportInputSchema
>

export const githubImportRepositoriesOutputSchema = z.object({
	repositories: z.array(githubImportRepositorySchema),
})
export type GitHubImportRepositoriesOutput = z.infer<
	typeof githubImportRepositoriesOutputSchema
>

export const githubImportContract = {
	listRepositories: oc
		.route({ method: 'GET', path: '/github-import/repositories' })
		.output(githubImportRepositoriesOutputSchema),
	createImport: oc
		.route({ method: 'POST', path: '/github-import/imports' })
		.input(createGitHubRepositoryImportInputSchema)
		.output(z.object({ import: githubRepositoryImportSchema })),
	listImports: oc
		.route({ method: 'GET', path: '/github-import/imports' })
		.output(z.object({ imports: z.array(githubRepositoryImportSchema) })),
	getImport: oc
		.route({ method: 'GET', path: '/github-import/imports/{id}' })
		.input(getGitHubRepositoryImportInputSchema)
		.output(z.object({ import: githubRepositoryImportSchema })),
	retryImport: oc
		.route({ method: 'POST', path: '/github-import/imports/{id}/retry' })
		.input(getGitHubRepositoryImportInputSchema)
		.output(z.object({ import: githubRepositoryImportSchema })),
}

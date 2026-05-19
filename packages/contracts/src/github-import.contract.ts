import { oc } from '@orpc/contract'
import { z } from 'zod'

export const githubImportRepositoryVisibilitySchema = z.enum([
	'public',
	'private',
	'internal',
])
export type GitHubImportRepositoryVisibility = z.infer<
	typeof githubImportRepositoryVisibilitySchema
>

export const githubImportRepositorySchema = z.object({
	githubId: z.number().int().nonnegative(),
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
}

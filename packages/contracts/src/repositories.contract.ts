import { oc } from '@orpc/contract'
import { z } from 'zod'

export const repositorySlugSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
	.brand<'repository_slug'>()
export type RepositorySlug = z.infer<typeof repositorySlugSchema>

export const repositoryNameSchema = z.string().trim().min(1).max(120)
export type RepositoryName = z.infer<typeof repositoryNameSchema>

export const repositorySchema = z.object({
	id: z.uuid().brand<'repository_id'>(),
	slug: repositorySlugSchema,
	name: z.string(),
	visibility: z.enum(['public', 'private']),
	description: z.string().optional(),
	defaultBranch: z.string(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type Repository = z.infer<typeof repositorySchema>

export const repositoryOwnerSchema = z.object({
	username: z.string().min(1),
})
export type RepositoryOwner = z.infer<typeof repositoryOwnerSchema>

export const repositoryWithOwnerSchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
})
export type RepositoryWithOwner = z.infer<typeof repositoryWithOwnerSchema>

export const createRepositoryInputSchema = z.object({
	name: repositoryNameSchema,
	slug: z.string().trim().min(1).max(64).optional(),
	description: z.string().trim().min(1).max(500).optional(),
	visibility: z.enum(['public', 'private']).optional(),
})
export type CreateRepositoryInput = z.infer<typeof createRepositoryInputSchema>

export const listRepositoriesInputSchema = z.object({
	username: z.string().min(1),
})
export type ListRepositoriesInput = z.infer<typeof listRepositoriesInputSchema>

export const getRepositoryInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})
export type GetRepositoryInput = z.infer<typeof getRepositoryInputSchema>

export const repositoriesContract = {
	create: oc
		.route({ method: 'POST', path: '/repositories' })
		.input(createRepositoryInputSchema)
		.output(repositoryWithOwnerSchema),
	list: oc
		.route({ method: 'GET', path: '/repositories/{username}' })
		.input(listRepositoriesInputSchema)
		.output(z.object({ repositories: z.array(repositoryWithOwnerSchema) })),
	get: oc
		.route({ method: 'GET', path: '/repositories/{username}/{slug}' })
		.input(getRepositoryInputSchema)
		.output(repositoryWithOwnerSchema),
}

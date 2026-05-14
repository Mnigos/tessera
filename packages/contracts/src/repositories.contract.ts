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

export const getRepositoryTreeInputSchema = getRepositoryInputSchema.extend({
	ref: z.string().min(1),
	path: z.string().optional(),
})
export type GetRepositoryTreeInput = z.infer<
	typeof getRepositoryTreeInputSchema
>

export const getRepositoryBlobInputSchema = getRepositoryInputSchema.extend({
	ref: z.string().min(1),
	path: z.string().min(1),
})
export type GetRepositoryBlobInput = z.infer<
	typeof getRepositoryBlobInputSchema
>

export const repositoryTreeEntrySchema = z.object({
	name: z.string(),
	objectId: z.string(),
	kind: z.enum(['file', 'directory', 'symlink', 'submodule', 'unknown']),
	sizeBytes: z.number().int().nonnegative(),
	path: z.string(),
	mode: z.string(),
})
export type RepositoryTreeEntry = z.infer<typeof repositoryTreeEntrySchema>

export const repositoryReadmeSchema = z.object({
	filename: z.string(),
	objectId: z.string(),
	content: z.string(),
	isTruncated: z.boolean(),
})
export type RepositoryReadme = z.infer<typeof repositoryReadmeSchema>

export const repositoryBrowserSummarySchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	isEmpty: z.boolean(),
	defaultBranch: z.string(),
	rootEntries: z.array(repositoryTreeEntrySchema),
	readme: repositoryReadmeSchema.optional(),
})
export type RepositoryBrowserSummary = z.infer<
	typeof repositoryBrowserSummarySchema
>

export const repositoryTreeSchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	ref: z.string(),
	commitId: z.string(),
	path: z.string(),
	entries: z.array(repositoryTreeEntrySchema),
})
export type RepositoryTree = z.infer<typeof repositoryTreeSchema>

export const repositoryBlobPreviewSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('text'),
		content: z.string(),
		language: z.string().optional(),
		highlighted: z
			.object({
				startLine: z.number().int().positive(),
				lines: z.array(
					z.object({
						number: z.number().int().positive(),
						html: z.string(),
					})
				),
			})
			.optional(),
	}),
	z.object({
		type: z.literal('binary'),
	}),
	z.object({
		type: z.literal('tooLarge'),
		previewLimitBytes: z.number().int().nonnegative(),
	}),
])
export type RepositoryBlobPreview = z.infer<typeof repositoryBlobPreviewSchema>

export const repositoryBlobSchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	ref: z.string(),
	path: z.string(),
	name: z.string(),
	objectId: z.string(),
	sizeBytes: z.number().int().nonnegative(),
	preview: repositoryBlobPreviewSchema,
})
export type RepositoryBlob = z.infer<typeof repositoryBlobSchema>

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
	getBrowserSummary: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/browser',
		})
		.input(getRepositoryInputSchema)
		.output(repositoryBrowserSummarySchema),
	getTree: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/tree/{ref}',
		})
		.input(getRepositoryTreeInputSchema)
		.output(repositoryTreeSchema),
	getBlob: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/blob/{ref}',
		})
		.input(getRepositoryBlobInputSchema)
		.output(repositoryBlobSchema),
	getRawBlob: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/raw/{ref}',
		})
		.input(getRepositoryBlobInputSchema)
		.output(z.file()),
}

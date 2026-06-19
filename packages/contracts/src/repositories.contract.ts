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

export const repositoryExternalSourceProviderSchema = z.enum(['github'])
export type RepositoryExternalSourceProvider = z.infer<
	typeof repositoryExternalSourceProviderSchema
>

export const repositoryMirrorModeSchema = z.enum([
	'imported',
	'github_to_tessera',
	'tessera_source',
])
export type RepositoryMirrorMode = z.infer<typeof repositoryMirrorModeSchema>

export const repositoryExternalSourceSyncStatusSchema = z.enum([
	'pending',
	'running',
	'succeeded',
	'failed',
])
export type RepositoryExternalSourceSyncStatus = z.infer<
	typeof repositoryExternalSourceSyncStatusSchema
>

export const repositoryGitHubPushBackStatusSchema = z.enum([
	'idle',
	'running',
	'succeeded',
	'failed',
])
export type RepositoryGitHubPushBackStatus = z.infer<
	typeof repositoryGitHubPushBackStatusSchema
>

export const repositoryExternalSourceSchema = z.discriminatedUnion('mode', [
	z.object({
		mode: z.literal('none'),
	}),
	z.object({
		mode: repositoryMirrorModeSchema,
		provider: repositoryExternalSourceProviderSchema,
		externalRepositoryId: z.string(),
		ownerLogin: z.string(),
		name: z.string(),
		fullName: z.string(),
		sourceUrl: z.url(),
		sourceDefaultBranch: z.string(),
		syncStatus: repositoryExternalSourceSyncStatusSchema,
		lastSyncStartedAt: z.coerce.date().optional(),
		lastSyncSucceededAt: z.coerce.date().optional(),
		lastSyncFailedAt: z.coerce.date().optional(),
		nextSyncAt: z.coerce.date().optional(),
		syncFailureReason: z.string().optional(),
		cutoverActorUserId: z.uuid().brand<'user_id'>().optional(),
		cutoverAt: z.coerce.date().optional(),
		cutoverFromMirrorMode: z.literal('github_to_tessera').optional(),
		githubPushBackEnabled: z.boolean().optional(),
		githubPushBackStatus: repositoryGitHubPushBackStatusSchema.optional(),
		githubPushBackStartedAt: z.coerce.date().optional(),
		githubPushBackSucceededAt: z.coerce.date().optional(),
		githubPushBackFailedAt: z.coerce.date().optional(),
		githubPushBackFailureReason: z.string().optional(),
		createdAt: z.coerce.date(),
		updatedAt: z.coerce.date(),
	}),
])
export type RepositoryExternalSource = z.infer<
	typeof repositoryExternalSourceSchema
>

export const repositorySchema = z.object({
	id: z.uuid().brand<'repository_id'>(),
	slug: repositorySlugSchema,
	name: z.string(),
	visibility: z.enum(['public', 'private']),
	description: z.string().optional(),
	defaultBranch: z.string(),
	externalSource: repositoryExternalSourceSchema,
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
export type CreateRepositoryInput = z.input<typeof createRepositoryInputSchema>

export const listRepositoriesInputSchema = z.object({
	username: z.string().min(1),
})
export type ListRepositoriesInput = z.input<typeof listRepositoriesInputSchema>

export const getRepositoryInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})
export type GetRepositoryInput = z.input<typeof getRepositoryInputSchema>
export type ParsedGetRepositoryInput = z.infer<typeof getRepositoryInputSchema>

export const cutoverGitHubMirrorInputSchema = getRepositoryInputSchema
export type CutoverGitHubMirrorInput = z.input<
	typeof cutoverGitHubMirrorInputSchema
>
export type ParsedCutoverGitHubMirrorInput = z.infer<
	typeof cutoverGitHubMirrorInputSchema
>

export const enableGitHubPushBackInputSchema = getRepositoryInputSchema
export type EnableGitHubPushBackInput = z.input<
	typeof enableGitHubPushBackInputSchema
>
export type ParsedEnableGitHubPushBackInput = z.infer<
	typeof enableGitHubPushBackInputSchema
>

export const disableGitHubPushBackInputSchema = getRepositoryInputSchema
export type DisableGitHubPushBackInput = z.input<
	typeof disableGitHubPushBackInputSchema
>
export type ParsedDisableGitHubPushBackInput = z.infer<
	typeof disableGitHubPushBackInputSchema
>

export const pushGitHubPushBackMirrorInputSchema = getRepositoryInputSchema
export type PushGitHubPushBackMirrorInput = z.input<
	typeof pushGitHubPushBackMirrorInputSchema
>
export type ParsedPushGitHubPushBackMirrorInput = z.infer<
	typeof pushGitHubPushBackMirrorInputSchema
>

export const getRepositoryBrowserSummaryInputSchema =
	getRepositoryInputSchema.extend({
		ref: z.string().min(1).optional(),
	})
export type GetRepositoryBrowserSummaryInput = z.input<
	typeof getRepositoryBrowserSummaryInputSchema
>
export type ParsedGetRepositoryBrowserSummaryInput = z.infer<
	typeof getRepositoryBrowserSummaryInputSchema
>

export const getRepositoryRefsInputSchema = getRepositoryInputSchema
export type GetRepositoryRefsInput = z.input<
	typeof getRepositoryRefsInputSchema
>
export type ParsedGetRepositoryRefsInput = z.infer<
	typeof getRepositoryRefsInputSchema
>

export const getRepositoryTreeInputSchema = getRepositoryInputSchema.extend({
	ref: z.string().min(1),
	path: z.string().optional(),
})
export type GetRepositoryTreeInput = z.input<
	typeof getRepositoryTreeInputSchema
>
export type ParsedGetRepositoryTreeInput = z.infer<
	typeof getRepositoryTreeInputSchema
>

export const getRepositoryBlobInputSchema = getRepositoryInputSchema.extend({
	ref: z.string().min(1),
	path: z.string().min(1),
})
export type GetRepositoryBlobInput = z.input<
	typeof getRepositoryBlobInputSchema
>
export type ParsedGetRepositoryBlobInput = z.infer<
	typeof getRepositoryBlobInputSchema
>

export const getRepositoryCommitHistoryInputSchema =
	getRepositoryInputSchema.extend({
		ref: z.string().min(1),
		limit: z.coerce.number().int().min(1).max(100).optional(),
	})
export type GetRepositoryCommitHistoryInput = z.input<
	typeof getRepositoryCommitHistoryInputSchema
>
export type ParsedGetRepositoryCommitHistoryInput = z.infer<
	typeof getRepositoryCommitHistoryInputSchema
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

export const repositoryBranchRefSchema = z.object({
	type: z.literal('branch'),
	name: z.string(),
	qualifiedName: z.string(),
	target: z.string(),
})
export type RepositoryBranchRef = z.infer<typeof repositoryBranchRefSchema>

export const repositorySignatureSchema = z.object({
	state: z.enum([
		'unsigned',
		'valid',
		'trusted',
		'untrusted',
		'bad',
		'unknown',
		'expired',
		'revoked',
	]),
	keyId: z.string().optional(),
	fingerprint: z.string().optional(),
	primaryKeyFingerprint: z.string().optional(),
	signer: z.string().optional(),
})
export type RepositorySignature = z.infer<typeof repositorySignatureSchema>

export const repositoryTagRefSchema = z.object({
	type: z.literal('tag'),
	name: z.string(),
	qualifiedName: z.string(),
	target: z.string(),
	signature: repositorySignatureSchema.optional(),
})
export type RepositoryTagRef = z.infer<typeof repositoryTagRefSchema>

export const repositoryRefSchema = z.discriminatedUnion('type', [
	repositoryBranchRefSchema,
	repositoryTagRefSchema,
])
export type RepositoryRef = z.infer<typeof repositoryRefSchema>

export const repositoryRefsSchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	branches: z.array(repositoryBranchRefSchema),
	tags: z.array(repositoryTagRefSchema),
})
export type RepositoryRefs = z.infer<typeof repositoryRefsSchema>

export const repositoryBrowserSummarySchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	isEmpty: z.boolean(),
	defaultBranch: z.string(),
	selectedRef: repositoryRefSchema.optional(),
	branches: z.array(repositoryBranchRefSchema),
	tags: z.array(repositoryTagRefSchema),
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

export const repositoryCommitIdentitySchema = z.object({
	name: z.string(),
	email: z.string(),
	date: z.string(),
})
export type RepositoryCommitIdentity = z.infer<
	typeof repositoryCommitIdentitySchema
>

export const repositoryCommitSchema = z.object({
	sha: z.string(),
	shortSha: z.string(),
	summary: z.string(),
	author: repositoryCommitIdentitySchema.optional(),
	committer: repositoryCommitIdentitySchema.optional(),
	signature: repositorySignatureSchema,
})
export type RepositoryCommit = z.infer<typeof repositoryCommitSchema>

export const repositoryCommitHistorySchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
	ref: z.string(),
	commits: z.array(repositoryCommitSchema),
})
export type RepositoryCommitHistory = z.infer<
	typeof repositoryCommitHistorySchema
>

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
	syncGitHubMirror: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/sync',
		})
		.input(getRepositoryInputSchema)
		.output(repositoryWithOwnerSchema),
	cutoverGitHubMirror: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/cutover',
		})
		.input(cutoverGitHubMirrorInputSchema)
		.output(repositoryWithOwnerSchema),
	enableGitHubPushBack: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/github-push-back/enable',
		})
		.input(enableGitHubPushBackInputSchema)
		.output(repositoryWithOwnerSchema),
	disableGitHubPushBack: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/github-push-back/disable',
		})
		.input(disableGitHubPushBackInputSchema)
		.output(repositoryWithOwnerSchema),
	pushGitHubPushBackMirror: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/github-push-back/push',
		})
		.input(pushGitHubPushBackMirrorInputSchema)
		.output(repositoryWithOwnerSchema),
	getBrowserSummary: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/browser',
		})
		.input(getRepositoryBrowserSummaryInputSchema)
		.output(repositoryBrowserSummarySchema),
	getRefs: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/refs',
		})
		.input(getRepositoryRefsInputSchema)
		.output(repositoryRefsSchema),
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
	getCommitHistory: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/commits/{ref}',
		})
		.input(getRepositoryCommitHistoryInputSchema)
		.output(repositoryCommitHistorySchema),
}

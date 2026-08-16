import { oc } from '@orpc/contract'
import { repositoryRoles } from '@repo/domain'
import { z } from 'zod'
import { checksSummarySchema } from './checks.contract'
import { type RepositorySlug, repositorySlugSchema } from './repository-slug'

/**
 * Refused because GitHub owns the repository. It answers a push and a comment
 * alike, so the wording names no particular action.
 */
export const REPOSITORY_GITHUB_SOURCE_OF_TRUTH_MESSAGE =
	'GitHub is the source of truth for this repository. Make this change on GitHub.'

export { type RepositorySlug, repositorySlugSchema }

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
	'blocked',
])
export type RepositoryExternalSourceSyncStatus = z.infer<
	typeof repositoryExternalSourceSyncStatusSchema
>

/**
 * How synchronization is doing, as opposed to what its last run did.
 *
 * `stale` and `partial` are derived on read rather than stored: a run that
 * finalized without reconciling everything still records `succeeded`, and a
 * mirror nobody has reconciled in hours is `succeeded` too. Neither is a state
 * the source row can hold, and both are the ones worth showing.
 */
export const repositorySyncHealthStateSchema = z.enum([
	'healthy',
	'pending',
	'stale',
	'partial',
	'failed',
	'blocked',
])
export type RepositorySyncHealthState = z.infer<
	typeof repositorySyncHealthStateSchema
>

/**
 * Why synchronization is not healthy, from a closed set Tessera writes itself.
 * Provider statuses, messages, and identifiers never reach it.
 */
export const repositorySyncHealthCodeSchema = z.enum([
	'installation_suspended',
	'missing_installation',
	'missing_storage',
	'rate_limited',
	'authentication_failed',
	'authorization_failed',
	'repository_unavailable',
	'resource_not_found',
	'provider_schema_mismatch',
	'provider_rejected_request',
	'upstream_unavailable',
	'reconciliation_failed',
])
export type RepositorySyncHealthCode = z.infer<
	typeof repositorySyncHealthCodeSchema
>

export const repositorySyncProgressSchema = z.object({
	stage: z.enum([
		'listing',
		'repository',
		'pull_requests',
		'conversations',
		'checks',
	]),
	current: z.number().int().nonnegative().optional(),
	total: z.number().int().nonnegative().optional(),
})
export type RepositorySyncProgressOutput = z.infer<
	typeof repositorySyncProgressSchema
>

export const repositorySyncHealthSchema = z.object({
	state: repositorySyncHealthStateSchema,
	/** What the running reconciliation is doing right now, while one runs. */
	progress: repositorySyncProgressSchema.optional(),
	/** How long ago the last successful reconciliation finished. */
	freshnessLagSeconds: z.number().int().nonnegative().optional(),
	/** How long the oldest unprocessed delivery has been waiting. */
	deliveryLagSeconds: z.number().int().nonnegative().optional(),
	pendingDeliveryCount: z.number().int().nonnegative(),
	retryCount24h: z.number().int().nonnegative(),
	failureRate24h: z.number().min(0).max(1),
	lastReconciliationDurationMs: z.number().int().nonnegative().optional(),
	rateLimitedUntil: z.coerce.date().optional(),
	code: repositorySyncHealthCodeSchema.optional(),
	message: z.string().optional(),
	/** Whether access has to be granted again on GitHub before this resumes. */
	reauthorizationRequired: z.boolean(),
})
export type RepositorySyncHealth = z.infer<typeof repositorySyncHealthSchema>

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

export const repositoryCloneAuthoritySchema = z.enum(['github', 'tessera'])
export type RepositoryCloneAuthority = z.infer<
	typeof repositoryCloneAuthoritySchema
>

const HTTP_CLONE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * `z.url()` accepts any scheme, including `javascript:`. A clone URL is put in
 * front of people to copy and is rendered as a link, so the scheme is checked
 * rather than assumed: a misconfigured base or an odd stored source must not
 * become something a reader can be talked into running.
 */
export function isHttpCloneUrl(value: string) {
	try {
		const url = new URL(value)

		return (
			HTTP_CLONE_PROTOCOLS.has(url.protocol) &&
			url.hostname.length > 0 &&
			!(url.username || url.password)
		)
	} catch {
		return false
	}
}

/**
 * The two forms Git accepts for an SSH remote: the scp-like shorthand every
 * GitHub repository is offered as, and a real `ssh://` URL.
 */
const SCP_LIKE_SSH_REMOTE_REGEX = /^[\w.-]+@[\w.-]+:[^\s:]+$/

export function isSshCloneRemote(value: string) {
	if (SCP_LIKE_SSH_REMOTE_REGEX.test(value)) return true

	try {
		const url = new URL(value)

		// A username such as git@ is how SSH names its account; a password in a
		// clone URL is never legitimate.
		return url.protocol === 'ssh:' && url.hostname.length > 0 && !url.password
	} catch {
		return false
	}
}

/**
 * Where a clone has to point, which is not always Tessera. While GitHub owns
 * the repository, a Tessera remote is a copy nobody can push to; the pair
 * switches the moment authority does, so it is derived here rather than
 * assembled from environment variables in the browser.
 */
export const repositoryCloneUrlsSchema = z.object({
	authority: repositoryCloneAuthoritySchema,
	https: z.url().refine(isHttpCloneUrl, {
		message: 'clone URL must use http or https',
	}),
	// GitHub's SSH remote is scp-like — `git@host:owner/name.git` — and parses
	// as no URL at all, so only Tessera's side of this is ever a URL.
	ssh: z.string().min(1).refine(isSshCloneRemote, {
		message: 'clone remote must be an ssh:// URL or git@host:path form',
	}),
})
export type RepositoryCloneUrls = z.infer<typeof repositoryCloneUrlsSchema>

export const repositorySchema = z.object({
	id: z.uuid().brand<'repository_id'>(),
	slug: repositorySlugSchema,
	name: z.string(),
	visibility: z.enum(['public', 'private']),
	description: z.string().optional(),
	defaultBranch: z.string(),
	externalSource: repositoryExternalSourceSchema,
	cloneUrls: repositoryCloneUrlsSchema,
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type Repository = z.infer<typeof repositorySchema>

export const repositoryOwnerKindSchema = z.enum(['user', 'organization'])
export type RepositoryOwnerKind = z.infer<typeof repositoryOwnerKindSchema>

export const repositoryOwnerSchema = z.object({
	kind: repositoryOwnerKindSchema,
	handle: z.string().min(1),
	/** @deprecated Alias of `handle`, kept for one release. */
	username: z.string().min(1),
})
export type RepositoryOwner = z.infer<typeof repositoryOwnerSchema>

export const repositoryViewerRoleSchema = z.enum(repositoryRoles)
export type RepositoryViewerRole = z.infer<typeof repositoryViewerRoleSchema>

export const repositoryWithOwnerSchema = z.object({
	repository: repositorySchema,
	owner: repositoryOwnerSchema,
})
export type RepositoryWithOwner = z.infer<typeof repositoryWithOwnerSchema>

export const createRepositoryOwnerSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('user') }),
	z.object({
		kind: z.literal('organization'),
		organizationId: z.uuid().brand<'organization_id'>(),
	}),
])
export type CreateRepositoryOwner = z.infer<typeof createRepositoryOwnerSchema>

export const createRepositoryInputSchema = z.object({
	name: repositoryNameSchema,
	slug: z.string().trim().min(1).max(64).optional(),
	description: z.string().trim().min(1).max(500).optional(),
	visibility: z.enum(['public', 'private']).optional(),
	owner: createRepositoryOwnerSchema.default({ kind: 'user' }),
})
export type CreateRepositoryInput = z.input<typeof createRepositoryInputSchema>
export type ParsedCreateRepositoryInput = z.infer<
	typeof createRepositoryInputSchema
>

export const listRepositoriesInputSchema = z.object({
	username: z.string().min(1),
})
export type ListRepositoriesInput = z.input<typeof listRepositoriesInputSchema>
export type ParsedListRepositoriesInput = z.infer<
	typeof listRepositoriesInputSchema
>

export const getRepositoryInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})
export type GetRepositoryInput = z.input<typeof getRepositoryInputSchema>
export type ParsedGetRepositoryInput = z.infer<typeof getRepositoryInputSchema>

export const enableGitHubMirrorInputSchema = getRepositoryInputSchema
export type EnableGitHubMirrorInput = z.input<
	typeof enableGitHubMirrorInputSchema
>
export type ParsedEnableGitHubMirrorInput = z.infer<
	typeof enableGitHubMirrorInputSchema
>

export const cutoverGitHubMirrorInputSchema = getRepositoryInputSchema
export type CutoverGitHubMirrorInput = z.input<
	typeof cutoverGitHubMirrorInputSchema
>
export type ParsedCutoverGitHubMirrorInput = z.infer<
	typeof cutoverGitHubMirrorInputSchema
>

export const getGitHubSyncHealthInputSchema = getRepositoryInputSchema
export type GetGitHubSyncHealthInput = z.input<
	typeof getGitHubSyncHealthInputSchema
>
export type ParsedGetGitHubSyncHealthInput = z.infer<
	typeof getGitHubSyncHealthInputSchema
>

export const getGitHubReauthorizationInputSchema = getRepositoryInputSchema
export type GetGitHubReauthorizationInput = z.input<
	typeof getGitHubReauthorizationInputSchema
>
export type ParsedGetGitHubReauthorizationInput = z.infer<
	typeof getGitHubReauthorizationInputSchema
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
	viewerRole: repositoryViewerRoleSchema,
	isEmpty: z.boolean(),
	defaultBranch: z.string(),
	selectedRef: repositoryRefSchema.optional(),
	branches: z.array(repositoryBranchRefSchema),
	tags: z.array(repositoryTagRefSchema),
	rootEntries: z.array(repositoryTreeEntrySchema),
	readme: repositoryReadmeSchema.optional(),
	commitCount: z.number().int().nonnegative(),
	openPullRequestCount: z.number().int().nonnegative(),
	collaboratorCount: z.number().int().nonnegative(),
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
	/**
	 * What was reported on the commit itself. History is not read against any
	 * target branch, so there is no policy here and nothing is ever `missing`:
	 * a commit no rule applies to has no requirements to have failed.
	 */
	checksSummary: checksSummarySchema.optional(),
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
	enableGitHubMirror: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/github-mirror/enable',
		})
		.input(enableGitHubMirrorInputSchema)
		.output(
			z.discriminatedUnion('status', [
				z.object({ status: z.literal('enabled') }),
				z.object({
					status: z.literal('installation_required'),
					installUrl: z.url(),
				}),
			])
		),
	cutoverGitHubMirror: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/cutover',
		})
		.input(cutoverGitHubMirrorInputSchema)
		.output(repositoryWithOwnerSchema),
	getGitHubSyncHealth: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/github-mirror/health',
		})
		.input(getGitHubSyncHealthInputSchema)
		.output(z.object({ syncHealth: repositorySyncHealthSchema.optional() })),
	getGitHubReauthorization: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/github-mirror/reauthorization',
		})
		.input(getGitHubReauthorizationInputSchema)
		.output(
			z.object({
				reauthorizationRequired: z.boolean(),
				installUrl: z.url().optional(),
			})
		),
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

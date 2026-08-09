import { oc } from '@orpc/contract'
import { checkKinds } from '@repo/domain'
import { z } from 'zod'
import { repositorySlugSchema } from './repository-slug'

export const checkIdSchema = z.uuid().brand<'check_id'>()
export type CheckId = z.infer<typeof checkIdSchema>

/**
 * A commit status and a check run of the same name are different checks — GitHub
 * treats them as separately requirable — so the kind travels with the context.
 */
export const checkKindSchema = z.enum(checkKinds)
export type CheckKind = z.infer<typeof checkKindSchema>

/**
 * `stale` is a result the provider invalidated itself. A result computed against
 * a commit the pull request has since moved past is not stale: that is
 * `headIsCurrent: false`, and the two must not be collapsed into one flag.
 */
export const checkStateSchema = z.enum([
	'queued',
	'pending',
	'success',
	'failure',
	'neutral',
	'canceled',
	'skipped',
	'timed_out',
	'stale',
])
export type CheckState = z.infer<typeof checkStateSchema>

/** `none` is a commit nothing reported on, which is not the same as passing. */
export const checkRollupStateSchema = z.enum([
	'none',
	'pending',
	'success',
	'failure',
])
export type CheckRollupState = z.infer<typeof checkRollupStateSchema>

export const checkProviderKindSchema = z.enum(['github', 'tessera'])
export type CheckProviderKind = z.infer<typeof checkProviderKindSchema>

/**
 * Who reported the result. A GitHub App is not a person and never appears as an
 * actor; this is the snapshot taken when the result was recorded, so a renamed
 * or uninstalled app still reads back the way it did then.
 */
export const checkProviderSchema = z.object({
	kind: checkProviderKindSchema,
	name: z.string().min(1),
	appSlug: z.string().min(1).optional(),
	url: z.url().optional(),
})
export type CheckProvider = z.infer<typeof checkProviderSchema>

/**
 * The effective result of one check on one commit: the newest observation of
 * the newest run competing for that context.
 */
export const checkSchema = z.object({
	id: checkIdSchema,
	kind: checkKindSchema,
	context: z.string().min(1),
	state: checkStateSchema,
	rawStatus: z.string().min(1).optional(),
	rawConclusion: z.string().min(1).optional(),
	provider: checkProviderSchema,
	targetUrl: z.url().optional(),
	description: z.string().optional(),
	outputTitle: z.string().optional(),
	outputSummary: z.string().optional(),
	startedAt: z.coerce.date().optional(),
	completedAt: z.coerce.date().optional(),
	durationMs: z.number().int().nonnegative().optional(),
	observedAt: z.coerce.date(),
})
export type Check = z.infer<typeof checkSchema>

/**
 * The rollup a list row or a commit dot renders from.
 *
 * It says what was reported, not what it costs: whether a result gates anything
 * is a branch rule's answer about one target branch, and the merge requirements
 * surface is where that answer is given. A rollup carrying its own enforcement
 * verdict would have to be right about a policy it cannot see.
 */
export const checksSummarySchema = z.object({
	headSha: z.string().min(1),
	overall: checkRollupStateSchema,
	counts: z.record(checkStateSchema, z.number().int().nonnegative()),
	/**
	 * When Tessera last recorded a result for the commit, which is not when it
	 * last looked: a sweep that finds nothing new moves nothing here.
	 */
	lastResultAt: z.coerce.date().optional(),
	/** False when the result describes a commit the pull request has moved past. */
	headIsCurrent: z.boolean(),
})
export type ChecksSummary = z.infer<typeof checksSummarySchema>

/**
 * A check a caller requires on a commit. `kind` and `providerAppId` are the
 * selectors GitHub itself needs to tell two identically named checks apart; a
 * requirement that omits them matches on the name alone.
 */
export const requiredContextSchema = z.object({
	context: z.string().min(1),
	kind: checkKindSchema.optional(),
	providerAppId: z.string().min(1).optional(),
})
export type RequiredContext = z.infer<typeof requiredContextSchema>

/**
 * What one requirement got on one commit. `missing` is a check nothing ever
 * reported, which is a failure to meet the requirement rather than an absent
 * opinion about it.
 */
export const requiredContextEvaluationSchema = z.object({
	requirement: requiredContextSchema,
	state: z.union([checkStateSchema, z.literal('missing')]),
	satisfied: z.boolean(),
	check: checkSchema.optional(),
})
export type RequiredContextEvaluation = z.infer<
	typeof requiredContextEvaluationSchema
>

export const checksListSchema = z.object({
	checks: z.array(checkSchema),
	/**
	 * Requirements the commit's target branch imposes that nothing has reported
	 * on. They are absences rather than results, so they travel beside the checks
	 * instead of being dressed up as one; a caller composing no policy gets an
	 * empty list.
	 */
	missingRequiredContexts: z.array(requiredContextSchema).default([]),
	headSha: z.string().min(1),
	headIsCurrent: z.boolean(),
	lastResultAt: z.coerce.date().optional(),
})
export type ChecksList = z.infer<typeof checksListSchema>

export const checkStatusProviderIdSchema = z
	.uuid()
	.brand<'check_status_provider_id'>()
export type CheckStatusProviderId = z.infer<typeof checkStatusProviderIdSchema>

export const checkStatusCredentialIdSchema = z
	.uuid()
	.brand<'check_status_credential_id'>()
export type CheckStatusCredentialId = z.infer<
	typeof checkStatusCredentialIdSchema
>

/**
 * One secret a provider publishes with, described without ever describing the
 * secret. `start` is the leading characters Tessera can still show, which is how
 * an admin recognizes the credential their CI is configured with; the secret
 * itself is readable exactly once, at creation.
 */
export const checkStatusCredentialSchema = z.object({
	id: checkStatusCredentialIdSchema,
	start: z.string().min(1).optional(),
	enabled: z.boolean(),
	createdAt: z.coerce.date(),
	revokedAt: z.coerce.date().optional(),
	expiresAt: z.coerce.date().optional(),
	lastUsedAt: z.coerce.date().optional(),
})
export type CheckStatusCredential = z.infer<typeof checkStatusCredentialSchema>

/**
 * An external system allowed to publish statuses to one repository. `key` is the
 * stable identity its results are filed under and never changes; `displayName`
 * is what a reader sees and may.
 */
export const checkStatusProviderSchema = z.object({
	id: checkStatusProviderIdSchema,
	key: z.string().min(1),
	displayName: z.string().min(1),
	credentials: z.array(checkStatusCredentialSchema),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type CheckStatusProvider = z.infer<typeof checkStatusProviderSchema>

const checkStatusProvidersInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
})

export const listCheckStatusProvidersInputSchema =
	checkStatusProvidersInputSchema
export type ListCheckStatusProvidersInput = z.input<
	typeof listCheckStatusProvidersInputSchema
>
export type ParsedListCheckStatusProvidersInput = z.infer<
	typeof listCheckStatusProvidersInputSchema
>

export const createCheckStatusProviderInputSchema =
	checkStatusProvidersInputSchema.extend({
		key: z
			.string()
			.trim()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
		displayName: z.string().trim().min(1).max(64),
		/** Seconds until the first credential expires; absent never expires. */
		expiresIn: z.number().int().positive().optional(),
	})
export type CreateCheckStatusProviderInput = z.input<
	typeof createCheckStatusProviderInputSchema
>
export type ParsedCreateCheckStatusProviderInput = z.infer<
	typeof createCheckStatusProviderInputSchema
>

export const createCheckStatusCredentialInputSchema =
	checkStatusProvidersInputSchema.extend({
		providerId: checkStatusProviderIdSchema,
		expiresIn: z.number().int().positive().optional(),
	})
export type CreateCheckStatusCredentialInput = z.input<
	typeof createCheckStatusCredentialInputSchema
>
export type ParsedCreateCheckStatusCredentialInput = z.infer<
	typeof createCheckStatusCredentialInputSchema
>

export const revokeCheckStatusCredentialInputSchema =
	checkStatusProvidersInputSchema.extend({
		credentialId: checkStatusCredentialIdSchema,
	})
export type RevokeCheckStatusCredentialInput = z.input<
	typeof revokeCheckStatusCredentialInputSchema
>
export type ParsedRevokeCheckStatusCredentialInput = z.infer<
	typeof revokeCheckStatusCredentialInputSchema
>

/**
 * The one moment the secret exists outside the caller's own configuration. It is
 * returned by value here and by nothing else, ever again.
 */
export const createdCheckStatusCredentialSchema = z.object({
	token: z.string().min(1),
	credential: checkStatusCredentialSchema,
	provider: checkStatusProviderSchema,
})
export type CreatedCheckStatusCredential = z.infer<
	typeof createdCheckStatusCredentialSchema
>

/**
 * What an external publisher may say about a commit. Deliberately narrower than
 * the states Tessera can store: `neutral`, `skipped` and the rest describe
 * outcomes GitHub's own model produces on import, and `stale` is a verdict only
 * the ledger's owner gets to reach about a result it already holds.
 */
export const publishableCheckStateSchema = z.enum([
	'pending',
	'success',
	'failure',
	'canceled',
])
export type PublishableCheckState = z.infer<typeof publishableCheckStateSchema>

export const publishCommitStatusInputSchema = z.object({
	username: z.string().min(1),
	slug: repositorySlugSchema,
	/**
	 * Format-checked and nothing more. CI routinely reports on a commit while the
	 * push carrying it is still in flight, so requiring the object to already be
	 * in storage would reject correct reports for being early.
	 */
	sha: z.string().regex(/^[0-9a-f]{40}([0-9a-f]{24})?$/),
	context: z.string().trim().min(1).max(255),
	state: publishableCheckStateSchema,
	targetUrl: z.url().max(2048).optional(),
	description: z.string().trim().max(1024).optional(),
	/** When the publisher decided this, if that differs from when it told us. */
	reportedAt: z.coerce.date().optional(),
	/**
	 * The caller's own name for this write. Required, because it is the only
	 * thing that can tell a retry of one report apart from a genuine second
	 * report of the same state — a distinction no content hash can make.
	 */
	idempotencyKey: z.string().trim().min(1).max(128),
})
export type PublishCommitStatusInput = z.input<
	typeof publishCommitStatusInputSchema
>
export type ParsedPublishCommitStatusInput = z.infer<
	typeof publishCommitStatusInputSchema
>

export const publishCommitStatusOutputSchema = z.object({
	checkId: checkIdSchema,
	sha: z.string().min(1),
	context: z.string().min(1),
	/**
	 * What the commit now carries for this context — the newest result in the
	 * publisher's stream, which is not necessarily the one this call reported. A
	 * replayed key answers with where the context has got to since.
	 */
	state: checkStateSchema,
	observedAt: z.coerce.date(),
	/** False when the idempotency key had already recorded this exact report. */
	created: z.boolean(),
})
export type PublishCommitStatusOutput = z.infer<
	typeof publishCommitStatusOutputSchema
>

export const checksContract = {
	publishStatus: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/commits/{sha}/statuses',
		})
		.input(publishCommitStatusInputSchema)
		.output(publishCommitStatusOutputSchema),
	listStatusProviders: oc
		.route({
			method: 'GET',
			path: '/repositories/{username}/{slug}/status-providers',
		})
		.input(listCheckStatusProvidersInputSchema)
		.output(z.object({ providers: z.array(checkStatusProviderSchema) })),
	createStatusProvider: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/status-providers',
		})
		.input(createCheckStatusProviderInputSchema)
		.output(createdCheckStatusCredentialSchema),
	createStatusCredential: oc
		.route({
			method: 'POST',
			path: '/repositories/{username}/{slug}/status-providers/{providerId}/credentials',
		})
		.input(createCheckStatusCredentialInputSchema)
		.output(createdCheckStatusCredentialSchema),
	revokeStatusCredential: oc
		.route({
			method: 'DELETE',
			path: '/repositories/{username}/{slug}/status-providers/credentials/{credentialId}',
		})
		.input(revokeCheckStatusCredentialInputSchema)
		.output(z.object({ revoked: z.boolean() })),
}

import { checkKinds } from '@repo/domain'
import { z } from 'zod'

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
 * The rollup a list row or a commit dot renders from. `enforcement` is a literal
 * because TES-66 imports results and never gates on them; the field exists so
 * required-context enforcement has somewhere to land without the read shape
 * changing meaning underneath the clients that already read it.
 */
export const checksSummarySchema = z.object({
	headSha: z.string().min(1),
	overall: checkRollupStateSchema,
	counts: z.record(checkStateSchema, z.number().int().nonnegative()),
	enforcement: z.literal('advisory'),
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
	headSha: z.string().min(1),
	headIsCurrent: z.boolean(),
	lastResultAt: z.coerce.date().optional(),
})
export type ChecksList = z.infer<typeof checksListSchema>

import { oc } from '@orpc/contract'
import { gitAccessTokenPermissions } from '@repo/domain'
import { z } from 'zod'

export const gitAccessTokenPermissionSchema = z.enum(gitAccessTokenPermissions)
export type GitAccessTokenPermission = z.infer<
	typeof gitAccessTokenPermissionSchema
>

export const gitAccessTokenSchema = z.object({
	id: z.uuid().brand<'apikey_id'>(),
	name: z.string().optional(),
	prefix: z.string().optional(),
	start: z.string().optional(),
	enabled: z.boolean(),
	permissions: z.record(z.string(), z.array(z.string())).optional(),
	expiresAt: z.coerce.date().optional(),
	lastRequest: z.coerce.date().optional(),
	createdAt: z.coerce.date(),
	updatedAt: z.coerce.date(),
})
export type GitAccessToken = z.infer<typeof gitAccessTokenSchema>

export const createGitAccessTokenInputSchema = z.object({
	name: z.string().trim().min(1).max(64).optional(),
	permissions: z.array(gitAccessTokenPermissionSchema).nonempty(),
	expiresIn: z.number().int().positive().optional(),
})
export type CreateGitAccessTokenInput = z.infer<
	typeof createGitAccessTokenInputSchema
>

export const createGitAccessTokenOutputSchema = z.object({
	token: z.string(),
	accessToken: gitAccessTokenSchema,
})
export type CreateGitAccessTokenOutput = z.infer<
	typeof createGitAccessTokenOutputSchema
>

export const revokeGitAccessTokenInputSchema = z.object({
	id: z.uuid().brand<'apikey_id'>(),
})
export type RevokeGitAccessTokenInput = z.infer<
	typeof revokeGitAccessTokenInputSchema
>

export const gitAccessTokensContract = {
	create: oc
		.route({ method: 'POST', path: '/git-access-tokens' })
		.input(createGitAccessTokenInputSchema)
		.output(createGitAccessTokenOutputSchema),
	list: oc
		.route({ method: 'GET', path: '/git-access-tokens' })
		.output(z.object({ accessTokens: z.array(gitAccessTokenSchema) })),
	revoke: oc
		.route({ method: 'DELETE', path: '/git-access-tokens/{id}' })
		.input(revokeGitAccessTokenInputSchema)
		.output(z.object({ success: z.boolean() })),
}

import { oc } from '@orpc/contract'
import { z } from 'zod'

export const publicUserSchema = z.object({
	id: z.uuid().brand<'user_id'>(),
	username: z.string().min(1),
	displayName: z.string(),
	avatarUrl: z.string().optional(),
})
export type PublicUser = z.infer<typeof publicUserSchema>

export const publicUserProfileInputSchema = z.object({
	username: z.string().min(1),
})
export type PublicUserProfileInput = z.infer<
	typeof publicUserProfileInputSchema
>

export const publicUserProfileOutputSchema = z.object({
	user: publicUserSchema,
})
export type PublicUserProfileOutput = z.infer<
	typeof publicUserProfileOutputSchema
>

export const userContract = {
	me: oc.route({ method: 'GET', path: '/user/me' }).output(
		z.object({
			user: publicUserSchema.optional(),
		})
	),
	profile: oc
		.route({ method: 'GET', path: '/user/{username}/profile' })
		.input(publicUserProfileInputSchema)
		.output(publicUserProfileOutputSchema),
}

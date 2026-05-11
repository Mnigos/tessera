import { oc } from '@orpc/contract'
import { z } from 'zod'

export const publicUserSchema = z.object({
	id: z.uuid().brand<'user_id'>(),
	username: z.string(),
	displayName: z.string(),
	avatarUrl: z.string().optional(),
})
export type PublicUser = z.infer<typeof publicUserSchema>

export const usersContract = {
	me: oc.route({ method: 'GET', path: '/users/me' }).output(
		z.object({
			user: publicUserSchema.optional(),
		})
	),
}

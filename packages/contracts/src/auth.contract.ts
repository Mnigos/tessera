import { oc } from '@orpc/contract'
import { z } from 'zod'

export const sessionUserSchema = z.object({
	id: z.uuid().brand<'user_id'>(),
	email: z.email(),
	username: z.string().min(1).optional(),
	displayName: z.string(),
	avatarUrl: z.url().optional(),
})
export type SessionUser = z.infer<typeof sessionUserSchema>

export const sessionOutputSchema = z.object({
	user: sessionUserSchema.optional(),
})
export type SessionOutput = z.infer<typeof sessionOutputSchema>

export const authContract = {
	session: oc
		.route({ method: 'GET', path: '/auth/session' })
		.output(sessionOutputSchema),
}

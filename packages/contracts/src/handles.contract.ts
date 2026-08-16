import { oc } from '@orpc/contract'
import { z } from 'zod'
import {
	organizationRoleSchema,
	organizationSchema,
} from './organizations.contract'
import { repositorySchema } from './repositories.contract'
import { publicUserSchema } from './user.contract'

// Unbounded on purpose: anything that is not a handle should read as 404, not 400.
export const handleInputSchema = z.object({
	handle: z.string().trim().toLowerCase(),
})
export type HandleInput = z.input<typeof handleInputSchema>
export type ParsedHandleInput = z.infer<typeof handleInputSchema>

export const handleRepositorySchema = repositorySchema.pick({
	id: true,
	slug: true,
	name: true,
	visibility: true,
})
export type HandleRepository = z.infer<typeof handleRepositorySchema>

export const handleOwnerSchema = z.discriminatedUnion('kind', [
	z.object({
		kind: z.literal('user'),
		user: publicUserSchema,
		viewerRole: z.literal('self').optional(),
	}),
	z.object({
		kind: z.literal('organization'),
		organization: organizationSchema,
		viewerRole: organizationRoleSchema.optional(),
	}),
])

export const handleProfileSchema = z.object({
	owner: handleOwnerSchema,
	repositories: z.array(handleRepositorySchema),
})
export type HandleProfile = z.infer<typeof handleProfileSchema>

export const handlesContract = {
	get: oc
		.route({ method: 'GET', path: '/handles/{handle}' })
		.input(handleInputSchema)
		.output(handleProfileSchema),
}

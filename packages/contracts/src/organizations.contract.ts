import { oc } from '@orpc/contract'
import {
	HANDLE_MAX_LENGTH,
	HANDLE_REGEX,
	organizationRoles,
} from '@repo/domain'
import { z } from 'zod'

export const organizationRoleSchema = z.enum(organizationRoles)

export const organizationSlugSchema = z
	.string()
	.trim()
	.toLowerCase()
	.min(1)
	.max(HANDLE_MAX_LENGTH)
	.regex(HANDLE_REGEX, {
		message:
			'Handle may use lowercase letters, numbers, and single dashes between them.',
	})

export const organizationNameSchema = z.string().trim().min(1).max(100)

export const organizationSchema = z.object({
	id: z.uuid().brand<'organization_id'>(),
	slug: z.string(),
	name: z.string(),
	createdAt: z.coerce.date(),
})
export type Organization = z.infer<typeof organizationSchema>

export const organizationMembershipSchema = organizationSchema.extend({
	role: organizationRoleSchema,
})
export type OrganizationMembership = z.infer<
	typeof organizationMembershipSchema
>

const organizationIdInputSchema = z.object({
	organizationId: z.uuid().brand<'organization_id'>(),
})

export const createOrganizationInputSchema = z.object({
	name: organizationNameSchema,
	slug: organizationSlugSchema,
})
export type ParsedCreateOrganizationInput = z.infer<
	typeof createOrganizationInputSchema
>

export const getOrganizationInputSchema = organizationIdInputSchema
export type GetOrganizationInput = z.input<typeof getOrganizationInputSchema>
export type ParsedGetOrganizationInput = z.infer<
	typeof getOrganizationInputSchema
>

export const updateOrganizationInputSchema = organizationIdInputSchema.extend({
	name: organizationNameSchema.optional(),
	slug: organizationSlugSchema.optional(),
})
export type ParsedUpdateOrganizationInput = z.infer<
	typeof updateOrganizationInputSchema
>

// In the DELETE body, not a query parameter: the handle would otherwise land in
// the access logs of a request that destroys what it names.
export const deleteOrganizationInputSchema = organizationIdInputSchema.extend({
	confirmationSlug: z.string().trim(),
})
export type ParsedDeleteOrganizationInput = z.infer<
	typeof deleteOrganizationInputSchema
>

export const organizationWithViewerRoleSchema = z.object({
	organization: organizationSchema,
	viewerRole: organizationRoleSchema,
})
export type OrganizationWithViewerRole = z.infer<
	typeof organizationWithViewerRoleSchema
>

export const organizationsContract = {
	list: oc
		.route({ method: 'GET', path: '/organizations' })
		.output(z.object({ organizations: z.array(organizationMembershipSchema) })),
	create: oc
		.route({ method: 'POST', path: '/organizations' })
		.input(createOrganizationInputSchema)
		.output(z.object({ organization: organizationSchema })),
	get: oc
		.route({ method: 'GET', path: '/organizations/{organizationId}' })
		.input(getOrganizationInputSchema)
		.output(organizationWithViewerRoleSchema),
	update: oc
		.route({ method: 'PATCH', path: '/organizations/{organizationId}' })
		.input(updateOrganizationInputSchema)
		.output(z.object({ organization: organizationSchema })),
	delete: oc
		.route({ method: 'DELETE', path: '/organizations/{organizationId}' })
		.input(deleteOrganizationInputSchema)
		.output(z.object({ deleted: z.literal(true) })),
}

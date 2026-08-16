import { oc } from '@orpc/contract'
import {
	HANDLE_MAX_LENGTH,
	HANDLE_REGEX,
	organizationRoles,
} from '@repo/domain'
import { z } from 'zod'

export const organizationRoleSchema = z.enum(organizationRoles)
export type OrganizationRole = z.infer<typeof organizationRoleSchema>

/**
 * An organization handle is a user handle: both name a page at `/{handle}` and
 * both prefix clone URLs, so neither namespace may accept what the other would
 * reject. Lowercased here rather than refused so a typed capital is not an
 * error the person has to read.
 */
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
export type OrganizationSlug = z.infer<typeof organizationSlugSchema>

export const organizationNameSchema = z.string().trim().min(1).max(100)
export type OrganizationName = z.infer<typeof organizationNameSchema>

export const organizationSchema = z.object({
	id: z.uuid().brand<'organization_id'>(),
	slug: z.string(),
	name: z.string(),
	logoUrl: z.url().optional(),
	createdAt: z.coerce.date(),
})
export type Organization = z.infer<typeof organizationSchema>

/** An organization as it looks to one of its members: the org, plus their role in it. */
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
export type CreateOrganizationInput = z.input<
	typeof createOrganizationInputSchema
>
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
export type UpdateOrganizationInput = z.input<
	typeof updateOrganizationInputSchema
>
export type ParsedUpdateOrganizationInput = z.infer<
	typeof updateOrganizationInputSchema
>

/**
 * The handle is typed back rather than a checkbox ticked: deletion is refused
 * outright while the organization owns repositories, and everything else it
 * removes — members, invitations — does not come back.
 *
 * It travels in the DELETE body, which oRPC's OpenAPI codec sends and reads for
 * every non-GET method. A query parameter would put the handle in access logs
 * of a request that destroys what it names.
 */
export const deleteOrganizationInputSchema = organizationIdInputSchema.extend({
	confirmationSlug: z.string().trim(),
})
export type DeleteOrganizationInput = z.input<
	typeof deleteOrganizationInputSchema
>
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

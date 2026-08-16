import { oc } from '@orpc/contract'
import {
	HANDLE_MAX_LENGTH,
	HANDLE_REGEX,
	organizationInvitationStatuses,
	organizationRoles,
} from '@repo/domain'
import { z } from 'zod'
import { publicUserSchema } from './user.contract'

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

// In the body so the handle stays out of access logs.
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

export const organizationInvitationStatusSchema = z.enum(
	organizationInvitationStatuses
)
export type OrganizationInvitationStatus = z.infer<
	typeof organizationInvitationStatusSchema
>

export const organizationMemberSchema = z.object({
	id: z.uuid().brand<'organization_member_id'>(),
	/** Null username: an account that has not been given a handle. */
	user: publicUserSchema.extend({ username: z.string().nullable() }),
	role: organizationRoleSchema,
	createdAt: z.coerce.date(),
})
export type OrganizationMember = z.infer<typeof organizationMemberSchema>

export const organizationInvitationSchema = z.object({
	id: z.uuid().brand<'organization_invitation_id'>(),
	organizationId: z.uuid().brand<'organization_id'>(),
	email: z.string(),
	role: organizationRoleSchema,
	status: organizationInvitationStatusSchema,
	expiresAt: z.coerce.date(),
	createdAt: z.coerce.date(),
	inviter: z.object({
		id: z.uuid().brand<'user_id'>(),
		username: z.string().nullable(),
		displayName: z.string(),
	}),
})
export type OrganizationInvitation = z.infer<
	typeof organizationInvitationSchema
>

/** The organization travels with it: the recipient is not a member yet. */
export const myOrganizationInvitationSchema =
	organizationInvitationSchema.extend({
		organization: z.object({
			id: z.uuid().brand<'organization_id'>(),
			slug: z.string(),
			name: z.string(),
		}),
	})
export type MyOrganizationInvitation = z.infer<
	typeof myOrganizationInvitationSchema
>

const organizationMemberIdInputSchema = organizationIdInputSchema.extend({
	memberId: z.uuid().brand<'organization_member_id'>(),
})

const organizationInvitationIdInputSchema = organizationIdInputSchema.extend({
	invitationId: z.uuid().brand<'organization_invitation_id'>(),
})

export const listOrganizationMembersInputSchema = organizationIdInputSchema
export type ListOrganizationMembersInput = z.input<
	typeof listOrganizationMembersInputSchema
>
export type ParsedListOrganizationMembersInput = z.infer<
	typeof listOrganizationMembersInputSchema
>

export const updateOrganizationMemberRoleInputSchema =
	organizationMemberIdInputSchema.extend({
		role: organizationRoleSchema,
	})
export type UpdateOrganizationMemberRoleInput = z.input<
	typeof updateOrganizationMemberRoleInputSchema
>
export type ParsedUpdateOrganizationMemberRoleInput = z.infer<
	typeof updateOrganizationMemberRoleInputSchema
>

export const removeOrganizationMemberInputSchema =
	organizationMemberIdInputSchema
export type RemoveOrganizationMemberInput = z.input<
	typeof removeOrganizationMemberInputSchema
>
export type ParsedRemoveOrganizationMemberInput = z.infer<
	typeof removeOrganizationMemberInputSchema
>

export const leaveOrganizationInputSchema = organizationIdInputSchema
export type LeaveOrganizationInput = z.input<
	typeof leaveOrganizationInputSchema
>
export type ParsedLeaveOrganizationInput = z.infer<
	typeof leaveOrganizationInputSchema
>

export const listOrganizationInvitationsInputSchema = organizationIdInputSchema
export type ListOrganizationInvitationsInput = z.input<
	typeof listOrganizationInvitationsInputSchema
>
export type ParsedListOrganizationInvitationsInput = z.infer<
	typeof listOrganizationInvitationsInputSchema
>

/** Lowercased so acceptance can match it against the signed-in address. */
// Piped so the format check sees the trimmed, lowercased value.
export const organizationInvitationEmailSchema = z
	.string()
	.trim()
	.toLowerCase()
	.max(320)
	.pipe(z.email())

export const inviteOrganizationMemberInputSchema =
	organizationIdInputSchema.extend({
		email: organizationInvitationEmailSchema,
		role: organizationRoleSchema,
	})
export type InviteOrganizationMemberInput = z.input<
	typeof inviteOrganizationMemberInputSchema
>
export type ParsedInviteOrganizationMemberInput = z.infer<
	typeof inviteOrganizationMemberInputSchema
>

export const resendOrganizationInvitationInputSchema =
	organizationInvitationIdInputSchema
export type ResendOrganizationInvitationInput = z.input<
	typeof resendOrganizationInvitationInputSchema
>
export type ParsedResendOrganizationInvitationInput = z.infer<
	typeof resendOrganizationInvitationInputSchema
>

export const cancelOrganizationInvitationInputSchema =
	organizationInvitationIdInputSchema
export type CancelOrganizationInvitationInput = z.input<
	typeof cancelOrganizationInvitationInputSchema
>
export type ParsedCancelOrganizationInvitationInput = z.infer<
	typeof cancelOrganizationInvitationInputSchema
>

export const myOrganizationInvitationInputSchema = z.object({
	invitationId: z.uuid().brand<'organization_invitation_id'>(),
})
export type MyOrganizationInvitationInput = z.input<
	typeof myOrganizationInvitationInputSchema
>
export type ParsedMyOrganizationInvitationInput = z.infer<
	typeof myOrganizationInvitationInputSchema
>

export const organizationMembersOutputSchema = z.object({
	members: z.array(organizationMemberSchema),
	viewerRole: organizationRoleSchema,
})
export type OrganizationMembersOutput = z.infer<
	typeof organizationMembersOutputSchema
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
	listMembers: oc
		.route({ method: 'GET', path: '/organizations/{organizationId}/members' })
		.input(listOrganizationMembersInputSchema)
		.output(organizationMembersOutputSchema),
	updateMemberRole: oc
		.route({
			method: 'PATCH',
			path: '/organizations/{organizationId}/members/{memberId}',
		})
		.input(updateOrganizationMemberRoleInputSchema)
		.output(z.object({ member: organizationMemberSchema })),
	removeMember: oc
		.route({
			method: 'DELETE',
			path: '/organizations/{organizationId}/members/{memberId}',
		})
		.input(removeOrganizationMemberInputSchema)
		.output(z.object({ removed: z.literal(true) })),
	leave: oc
		.route({ method: 'POST', path: '/organizations/{organizationId}/leave' })
		.input(leaveOrganizationInputSchema)
		.output(z.object({ left: z.literal(true) })),
	listInvitations: oc
		.route({
			method: 'GET',
			path: '/organizations/{organizationId}/invitations',
		})
		.input(listOrganizationInvitationsInputSchema)
		.output(z.object({ invitations: z.array(organizationInvitationSchema) })),
	invite: oc
		.route({
			method: 'POST',
			path: '/organizations/{organizationId}/invitations',
		})
		.input(inviteOrganizationMemberInputSchema)
		.output(z.object({ invitation: organizationInvitationSchema })),
	resendInvitation: oc
		.route({
			method: 'POST',
			path: '/organizations/{organizationId}/invitations/{invitationId}/resend',
		})
		.input(resendOrganizationInvitationInputSchema)
		.output(z.object({ invitation: organizationInvitationSchema })),
	cancelInvitation: oc
		.route({
			method: 'DELETE',
			path: '/organizations/{organizationId}/invitations/{invitationId}',
		})
		.input(cancelOrganizationInvitationInputSchema)
		.output(z.object({ canceled: z.literal(true) })),
	listMyInvitations: oc
		.route({ method: 'GET', path: '/organization-invitations' })
		.output(z.object({ invitations: z.array(myOrganizationInvitationSchema) })),
	getMyInvitation: oc
		.route({ method: 'GET', path: '/organization-invitations/{invitationId}' })
		.input(myOrganizationInvitationInputSchema)
		.output(z.object({ invitation: myOrganizationInvitationSchema })),
	acceptInvitation: oc
		.route({
			method: 'POST',
			path: '/organization-invitations/{invitationId}/accept',
		})
		.input(myOrganizationInvitationInputSchema)
		.output(z.object({ organization: organizationMembershipSchema })),
	declineInvitation: oc
		.route({
			method: 'POST',
			path: '/organization-invitations/{invitationId}/decline',
		})
		.input(myOrganizationInvitationInputSchema)
		.output(z.object({ declined: z.literal(true) })),
}

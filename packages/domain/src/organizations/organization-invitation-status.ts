export const organizationInvitationStatuses = [
	'pending',
	'accepted',
	'rejected',
	'canceled',
] as const

export type OrganizationInvitationStatus =
	(typeof organizationInvitationStatuses)[number]

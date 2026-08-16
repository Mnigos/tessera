export const organizationRoles = ['owner', 'admin', 'member'] as const

export type OrganizationRole = (typeof organizationRoles)[number]

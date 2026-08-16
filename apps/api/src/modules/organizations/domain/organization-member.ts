import type { OrganizationMember as OrganizationMemberOutput } from '@repo/contracts'
import type {
	OrganizationMemberId,
	OrganizationRole,
	UserId,
} from '@repo/domain'

export interface OrganizationMemberUserView {
	id: UserId
	username: string | null
	name: string
	image: string | null
}

export interface OrganizationMemberView {
	id: OrganizationMemberId
	role: OrganizationRole
	createdAt: Date
	user: OrganizationMemberUserView
}

export function toOrganizationMemberOutput({
	id,
	role,
	createdAt,
	user,
}: OrganizationMemberView): OrganizationMemberOutput {
	return {
		id,
		role,
		createdAt,
		user: {
			id: user.id,
			username: user.username,
			displayName: user.name,
			avatarUrl: user.image ?? undefined,
		},
	}
}

import type { OrganizationMember } from '@repo/contracts'
import type { OrganizationRole } from '@repo/domain'

interface OrganizationMemberPermissionsInput {
	member: OrganizationMember
	viewerRole: OrganizationRole
	viewerUserId: OrganizationMember['user']['id'] | undefined
	ownerCount: number
}

export interface OrganizationMemberPermissions {
	isViewer: boolean
	canChangeRole: boolean
	canRemove: boolean
	canLeave: boolean
	restriction?: string
}

const LAST_OWNER_RESTRICTION = 'An organization needs at least one owner.'
const OWNER_ONLY_RESTRICTION = 'Only owners can manage owners.'

const DENIED = {
	canChangeRole: false,
	canRemove: false,
	canLeave: false,
} as const

/** Disables what the API would refuse; the API stays the authority. */
export function getOrganizationMemberPermissions({
	member,
	ownerCount,
	viewerRole,
	viewerUserId,
}: OrganizationMemberPermissionsInput): OrganizationMemberPermissions {
	const isViewer = member.user.id === viewerUserId
	const isOwner = member.role === 'owner'
	const isLastOwner = isOwner && ownerCount <= 1

	if (isViewer)
		return {
			...DENIED,
			isViewer,
			// Leaving is the deliberate version of demoting yourself.
			canLeave: !isLastOwner,
			restriction: isLastOwner ? LAST_OWNER_RESTRICTION : undefined,
		}

	if (viewerRole === 'member') return { ...DENIED, isViewer }

	if (isLastOwner)
		return { ...DENIED, isViewer, restriction: LAST_OWNER_RESTRICTION }

	if (isOwner && viewerRole !== 'owner')
		return { ...DENIED, isViewer, restriction: OWNER_ONLY_RESTRICTION }

	return { isViewer, canChangeRole: true, canRemove: true, canLeave: false }
}

export function countOrganizationOwners(members: OrganizationMember[]): number {
	return members.filter(member => member.role === 'owner').length
}

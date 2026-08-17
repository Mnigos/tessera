import type { Organization, OrganizationMember } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { UserMinus } from 'lucide-react'
import { useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { getOrganizationMemberName } from '../helpers/get-organization-member-name'
import { useRemoveOrganizationMemberMutation } from '../hooks/use-remove-organization-member.mutation'
import { ConfirmActionDialog } from './confirm-action-dialog'

interface RemoveOrganizationMemberDialogProps {
	member: OrganizationMember
	organizationId: Organization['id']
	organizationName: string
}

export function RemoveOrganizationMemberDialog({
	member,
	organizationId,
	organizationName,
}: Readonly<RemoveOrganizationMemberDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const removeMember = useRemoveOrganizationMemberMutation()
	const memberName = getOrganizationMemberName(member.user)

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) removeMember.reset()
	}

	function handleRemove() {
		removeMember.mutate(
			{ organizationId, memberId: member.id },
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	return (
		<ConfirmActionDialog
			confirmLabel="Remove member"
			description={`Removing ${memberName} ends their membership of ${organizationName}. Repositories the organization owns stay where they are, and they can be invited again.`}
			errorMessage={
				removeMember.isError
					? getOrganizationErrorMessage(
							removeMember.error,
							'Member could not be removed.'
						)
					: undefined
			}
			isPending={removeMember.isPending}
			onConfirm={handleRemove}
			onOpenChange={handleOpenChange}
			open={isOpen}
			pendingLabel="Removing"
			title="Remove member"
			trigger={
				<Button aria-label={`Remove ${memberName}`} size="icon" variant="ghost">
					<UserMinus className="size-4 text-muted-foreground" />
				</Button>
			}
		/>
	)
}

import type { Organization } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { useNavigate } from '@tanstack/react-router'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { useLeaveOrganizationMutation } from '../hooks/use-leave-organization.mutation'
import { ConfirmActionDialog } from './confirm-action-dialog'

interface LeaveOrganizationDialogProps {
	organizationId: Organization['id']
	organizationName: string
}

export function LeaveOrganizationDialog({
	organizationId,
	organizationName,
}: Readonly<LeaveOrganizationDialogProps>) {
	const navigate = useNavigate()
	const { user } = useAuth()
	const [isOpen, setIsOpen] = useState(false)
	const leaveOrganization = useLeaveOrganizationMutation()

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) leaveOrganization.reset()
	}

	function handleLeave() {
		leaveOrganization.mutate(
			{ organizationId },
			{
				onSuccess: () =>
					navigate(
						user?.username
							? {
									to: '/profile/$username',
									params: { username: user.username },
								}
							: { to: '/profile' }
					),
			}
		)
	}

	return (
		<ConfirmActionDialog
			cancelLabel="Stay"
			confirmLabel="Leave organization"
			description="You lose access to everything the organization owns. Another member has to invite you back."
			errorMessage={
				leaveOrganization.isError
					? getOrganizationErrorMessage(
							leaveOrganization.error,
							'You could not leave this organization.'
						)
					: undefined
			}
			isPending={leaveOrganization.isPending}
			onConfirm={handleLeave}
			onOpenChange={handleOpenChange}
			open={isOpen}
			pendingLabel="Leaving"
			title={`Leave ${organizationName}?`}
			trigger={
				<Button size="sm" variant="secondary">
					<LogOut className="size-4" />
					Leave
				</Button>
			}
		/>
	)
}

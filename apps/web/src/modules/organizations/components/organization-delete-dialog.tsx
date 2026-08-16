import type { Organization } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Input } from '@repo/ui/components/input'
import { Label } from '@repo/ui/components/label'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { useDeleteOrganizationMutation } from '../hooks/use-delete-organization.mutation'
import { ConfirmActionDialog } from './confirm-action-dialog'

interface OrganizationDeleteDialogProps {
	organization: Organization
}

export function OrganizationDeleteDialog({
	organization,
}: Readonly<OrganizationDeleteDialogProps>) {
	const navigate = useNavigate()
	const [isOpen, setIsOpen] = useState(false)
	const [confirmationSlug, setConfirmationSlug] = useState('')
	const deleteOrganization = useDeleteOrganizationMutation()

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) {
			setConfirmationSlug('')
			deleteOrganization.reset()
		}
	}

	function handleDelete() {
		deleteOrganization.mutate(
			{ organizationId: organization.id, confirmationSlug },
			{ onSuccess: () => navigate({ to: '/profile' }) }
		)
	}

	return (
		<Card className="gap-4 border-destructive/40">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Delete organization
				</h2>
				<p className="text-muted-foreground text-sm">
					Members and pending invitations are removed with it. Transfer or
					delete its repositories first.
				</p>
			</div>
			<ConfirmActionDialog
				confirmLabel="Delete forever"
				description={
					<>
						This cannot be undone. Type{' '}
						<span className="font-medium text-foreground">
							{organization.slug}
						</span>{' '}
						to confirm.
					</>
				}
				disabled={confirmationSlug !== organization.slug}
				errorMessage={
					deleteOrganization.isError
						? getOrganizationErrorMessage(
								deleteOrganization.error,
								'Organization could not be deleted.'
							)
						: undefined
				}
				isPending={deleteOrganization.isPending}
				onConfirm={handleDelete}
				onOpenChange={handleOpenChange}
				open={isOpen}
				pendingLabel="Deleting"
				title={`Delete ${organization.name}?`}
				trigger={<Button variant="destructive">Delete organization</Button>}
			>
				<div className="flex flex-col gap-2">
					<Label htmlFor="organization-delete-confirmation">Handle</Label>
					<Input
						autoCapitalize="none"
						autoComplete="off"
						id="organization-delete-confirmation"
						onChange={event =>
							setConfirmationSlug(event.target.value.toLowerCase())
						}
						spellCheck={false}
						value={confirmationSlug}
					/>
				</div>
			</ConfirmActionDialog>
		</Card>
	)
}

import type { Organization } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui/components/dialog'
import { Label } from '@repo/ui/components/label'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { getOrganizationErrorMessage } from '../helpers/get-organization-error-message'
import { useDeleteOrganizationMutation } from '../hooks/use-delete-organization.mutation'

const CONFIRMATION_INPUT_CLASSNAME =
	'h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring'

interface OrganizationDeleteDialogProps {
	organization: Organization
}

/**
 * Deleting is owner-only and irreversible, so the handle is typed back rather
 * than a button confirmed. The dialog stays open on failure: the common refusal
 * — the organization still owns repositories — is something the person has to
 * go and act on, and closing would take the reason with it.
 */
export function OrganizationDeleteDialog({
	organization,
}: Readonly<OrganizationDeleteDialogProps>) {
	const navigate = useNavigate()
	const [isOpen, setIsOpen] = useState(false)
	const [confirmationSlug, setConfirmationSlug] = useState('')
	const deleteOrganization = useDeleteOrganizationMutation()
	const isConfirmed = confirmationSlug === organization.slug

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
			<Dialog onOpenChange={handleOpenChange} open={isOpen}>
				<DialogTrigger render={<Button variant="destructive" />}>
					Delete organization
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {organization.name}?</DialogTitle>
						<DialogDescription>
							This cannot be undone. Type{' '}
							<span className="font-medium text-foreground">
								{organization.slug}
							</span>{' '}
							to confirm.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-2">
						<Label htmlFor="organization-delete-confirmation">Handle</Label>
						<input
							autoCapitalize="none"
							autoComplete="off"
							className={CONFIRMATION_INPUT_CLASSNAME}
							id="organization-delete-confirmation"
							onChange={event =>
								setConfirmationSlug(event.target.value.toLowerCase())
							}
							spellCheck={false}
							value={confirmationSlug}
						/>
					</div>
					{deleteOrganization.isError && (
						<p className="text-destructive text-sm" role="alert">
							{getOrganizationErrorMessage(
								deleteOrganization.error,
								'Organization could not be deleted.'
							)}
						</p>
					)}
					<DialogFooter>
						<DialogClose render={<Button variant="secondary" />}>
							Cancel
						</DialogClose>
						<Button
							disabled={!isConfirmed || deleteOrganization.isPending}
							onClick={handleDelete}
							variant="destructive"
						>
							{deleteOrganization.isPending ? 'Deleting' : 'Delete forever'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Card>
	)
}

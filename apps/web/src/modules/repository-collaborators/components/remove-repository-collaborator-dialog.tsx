import type { RepositoryCollaborator } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
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
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { getRepositoryCollaboratorErrorMessage } from '../helpers/get-repository-collaborator-error-message'
import { useRemoveRepositoryCollaboratorMutation } from '../hooks/use-remove-repository-collaborator.mutation'

interface RemoveRepositoryCollaboratorDialogProps {
	username: string
	slug: string
	collaborator: RepositoryCollaborator
}

export function RemoveRepositoryCollaboratorDialog({
	username,
	slug,
	collaborator,
}: Readonly<RemoveRepositoryCollaboratorDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const removeCollaborator = useRemoveRepositoryCollaboratorMutation()

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) removeCollaborator.reset()
	}

	function handleRemove() {
		removeCollaborator.mutate(
			{ username, slug, collaboratorUsername: collaborator.username },
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger
				render={
					<Button
						aria-label={`Remove ${collaborator.username}`}
						size="icon"
						variant="ghost"
					/>
				}
			>
				<Trash2 className="size-4 text-muted-foreground" />
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Remove collaborator</DialogTitle>
					<DialogDescription>
						Removing @{collaborator.username} revokes their access to {username}
						/{slug}. They can be added again later.
					</DialogDescription>
				</DialogHeader>
				{removeCollaborator.isError && (
					<p className="text-destructive text-sm" role="alert">
						{getRepositoryCollaboratorErrorMessage(removeCollaborator.error, {
							fallback: 'Collaborator could not be removed.',
							notFound: 'This user is no longer a collaborator.',
						})}
					</p>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="secondary" />}>
						Cancel
					</DialogClose>
					<Button
						disabled={removeCollaborator.isPending}
						onClick={handleRemove}
						variant="destructive"
					>
						{removeCollaborator.isPending ? 'Removing' : 'Remove collaborator'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

import type { RepositoryCollaboratorRole } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Label } from '@repo/ui/components/label'
import { UserPlus } from 'lucide-react'
import { type ComponentProps, useState } from 'react'
import { getRepositoryCollaboratorErrorMessage } from '../helpers/get-repository-collaborator-error-message'
import { useAddRepositoryCollaboratorMutation } from '../hooks/use-add-repository-collaborator.mutation'
import { RepositoryCollaboratorRoleSelect } from './repository-collaborator-role-select'

const ADD_COLLABORATOR_ERROR_ID = 'add-repository-collaborator-error'
const DEFAULT_COLLABORATOR_ROLE: RepositoryCollaboratorRole = 'write'

interface AddRepositoryCollaboratorFormProps {
	username: string
	slug: string
}

export function AddRepositoryCollaboratorForm({
	username,
	slug,
}: Readonly<AddRepositoryCollaboratorFormProps>) {
	const [role, setRole] = useState<RepositoryCollaboratorRole>(
		DEFAULT_COLLABORATOR_ROLE
	)
	const addCollaborator = useAddRepositoryCollaboratorMutation()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const form = event.currentTarget
		const collaboratorUsername = String(
			new FormData(form).get('username') ?? ''
		).trim()

		if (!collaboratorUsername) return

		addCollaborator.mutate(
			{ username, slug, collaboratorUsername, role },
			{
				onSuccess: () => {
					form.reset()
					setRole(DEFAULT_COLLABORATOR_ROLE)
				},
			}
		)
	}

	return (
		<Card className="gap-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Add collaborator
				</h2>
				<p className="text-muted-foreground text-sm">
					Grant another user access to this repository.
				</p>
			</div>
			<form
				aria-describedby={
					addCollaborator.isError ? ADD_COLLABORATOR_ERROR_ID : undefined
				}
				className="flex flex-col gap-4"
				onSubmit={handleSubmit}
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-end">
					<div className="flex flex-1 flex-col gap-2">
						<Label htmlFor="collaborator-username">Username</Label>
						<input
							className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
							id="collaborator-username"
							name="username"
							required
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="collaborator-role">Role</Label>
						<RepositoryCollaboratorRoleSelect
							id="collaborator-role"
							onRoleChange={setRole}
							role={role}
						/>
					</div>
					<Button
						className="w-full sm:w-auto"
						disabled={addCollaborator.isPending}
						type="submit"
					>
						<UserPlus className="size-4" />
						{addCollaborator.isPending ? 'Adding' : 'Add collaborator'}
					</Button>
				</div>
				{addCollaborator.isError && (
					<p
						className="text-destructive text-sm"
						id={ADD_COLLABORATOR_ERROR_ID}
						role="alert"
					>
						{getRepositoryCollaboratorErrorMessage(addCollaborator.error, {
							fallback: 'Collaborator could not be added.',
							notFound: 'User not found.',
						})}
					</p>
				)}
			</form>
		</Card>
	)
}

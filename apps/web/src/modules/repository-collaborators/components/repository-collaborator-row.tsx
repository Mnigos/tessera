import type {
	RepositoryCollaborator,
	RepositoryCollaboratorRole,
} from '@repo/contracts'
import { formatRepositoryCollaboratorAddedDate } from '../helpers/format-repository-collaborator-added-date'
import { getRepositoryCollaboratorErrorMessage } from '../helpers/get-repository-collaborator-error-message'
import { useUpdateRepositoryCollaboratorRoleMutation } from '../hooks/use-update-repository-collaborator-role.mutation'
import { RemoveRepositoryCollaboratorDialog } from './remove-repository-collaborator-dialog'
import { RepositoryCollaboratorRoleSelect } from './repository-collaborator-role-select'

interface RepositoryCollaboratorRowProps {
	username: string
	slug: string
	collaborator: RepositoryCollaborator
}

export function RepositoryCollaboratorRow({
	username,
	slug,
	collaborator,
}: Readonly<RepositoryCollaboratorRowProps>) {
	const updateRole = useUpdateRepositoryCollaboratorRoleMutation()

	function handleRoleChange(role: RepositoryCollaboratorRole) {
		if (role === collaborator.role) return

		updateRole.mutate({
			username,
			slug,
			collaboratorUsername: collaborator.username,
			role,
		})
	}

	return (
		<li className="flex flex-col gap-2 px-4 py-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="truncate font-medium text-sm">
						{collaborator.username}
					</p>
					<p className="text-muted-foreground text-xs">
						Added{' '}
						{formatRepositoryCollaboratorAddedDate(collaborator.createdAt)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<RepositoryCollaboratorRoleSelect
						ariaLabel={`Change role for ${collaborator.username}`}
						disabled={updateRole.isPending}
						onRoleChange={handleRoleChange}
						role={collaborator.role}
					/>
					<RemoveRepositoryCollaboratorDialog
						collaborator={collaborator}
						slug={slug}
						username={username}
					/>
				</div>
			</div>
			{updateRole.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getRepositoryCollaboratorErrorMessage(updateRole.error, {
						fallback: 'Role could not be updated.',
						notFound: 'This user is no longer a collaborator.',
					})}
				</p>
			)}
		</li>
	)
}

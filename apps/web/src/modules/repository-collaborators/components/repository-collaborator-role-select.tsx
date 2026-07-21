import type { RepositoryCollaboratorRole } from '@repo/contracts'
import { repositoryCollaboratorRoles } from '@repo/domain'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'

interface RepositoryCollaboratorRoleSelectProps {
	ariaLabel?: string
	disabled?: boolean
	id?: string
	onRoleChange: (role: RepositoryCollaboratorRole) => void
	role: RepositoryCollaboratorRole
}

export function RepositoryCollaboratorRoleSelect({
	ariaLabel,
	disabled = false,
	id,
	onRoleChange,
	role,
}: Readonly<RepositoryCollaboratorRoleSelectProps>) {
	function handleValueChange(value: RepositoryCollaboratorRole | null) {
		if (!value) return

		onRoleChange(value)
	}

	return (
		<Select disabled={disabled} onValueChange={handleValueChange} value={role}>
			<SelectTrigger
				aria-label={ariaLabel}
				className="min-w-28 capitalize"
				id={id}
			>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="end">
				{repositoryCollaboratorRoles.map(roleOption => (
					<SelectItem
						className="capitalize"
						key={roleOption}
						value={roleOption}
					>
						{roleOption}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

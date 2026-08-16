import { type OrganizationRole, organizationRoles } from '@repo/domain'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'

interface OrganizationRoleSelectProps {
	role: OrganizationRole
	onRoleChange: (role: OrganizationRole) => void
	canAssignOwner: boolean
	ariaLabel?: string
	disabled?: boolean
	id?: string
}

export function OrganizationRoleSelect({
	ariaLabel,
	canAssignOwner,
	disabled = false,
	id,
	onRoleChange,
	role,
}: Readonly<OrganizationRoleSelectProps>) {
	// The current role is always offered, or the select cannot show its value.
	const roles = organizationRoles.filter(
		option => option !== 'owner' || canAssignOwner || option === role
	)

	function handleValueChange(value: OrganizationRole | null) {
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
				{roles.map(roleOption => (
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

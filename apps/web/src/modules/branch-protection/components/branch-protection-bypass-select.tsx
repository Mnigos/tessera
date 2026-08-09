import type { BranchProtectionBypassPolicy } from '@repo/contracts'
import { branchProtectionBypassRoles } from '@repo/domain'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'

const BYPASS_DISABLED_VALUE = 'disabled'

type BranchProtectionBypassValue =
	| typeof BYPASS_DISABLED_VALUE
	| (typeof branchProtectionBypassRoles)[number]

const BYPASS_VALUES: BranchProtectionBypassValue[] = [
	BYPASS_DISABLED_VALUE,
	...branchProtectionBypassRoles,
]

const BYPASS_LABELS: Record<BranchProtectionBypassValue, string> = {
	disabled: 'Nobody',
	admin: 'Admins and owners',
	owner: 'Owners only',
}

interface BranchProtectionBypassSelectProps {
	bypass: BranchProtectionBypassPolicy
	disabled?: boolean
	id?: string
	onBypassChange: (bypass: BranchProtectionBypassPolicy) => void
}

export function BranchProtectionBypassSelect({
	bypass,
	disabled = false,
	id,
	onBypassChange,
}: Readonly<BranchProtectionBypassSelectProps>) {
	const selectedValue: BranchProtectionBypassValue = bypass.allowed
		? bypass.minimumRole
		: BYPASS_DISABLED_VALUE

	function handleValueChange(value: BranchProtectionBypassValue | null) {
		if (!value) return

		onBypassChange(
			value === BYPASS_DISABLED_VALUE
				? { allowed: false }
				: { allowed: true, minimumRole: value }
		)
	}

	return (
		<Select
			disabled={disabled}
			onValueChange={handleValueChange}
			value={selectedValue}
		>
			<SelectTrigger className="min-w-48" id={id}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent align="start">
				{BYPASS_VALUES.map(value => (
					<SelectItem key={value} value={value}>
						{BYPASS_LABELS[value]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

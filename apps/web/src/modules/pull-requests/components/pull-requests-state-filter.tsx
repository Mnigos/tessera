import type { PullRequestState } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'

interface PullRequestStateFilterOption {
	label: string
	value?: PullRequestState
}

const PULL_REQUEST_STATE_FILTER_OPTIONS: PullRequestStateFilterOption[] = [
	{ label: 'Open', value: 'open' },
	{ label: 'Closed', value: 'closed' },
	{ label: 'Merged', value: 'merged' },
	{ label: 'All' },
]

interface PullRequestsStateFilterProps {
	selectedState?: PullRequestState
	onSelectedStateChange: (state?: PullRequestState) => void
}

export function PullRequestsStateFilter({
	selectedState,
	onSelectedStateChange,
}: Readonly<PullRequestsStateFilterProps>) {
	return (
		<fieldset
			aria-label="Filter pull requests by state"
			className="flex flex-wrap items-center gap-1"
		>
			{PULL_REQUEST_STATE_FILTER_OPTIONS.map(option => (
				<Button
					aria-pressed={option.value === selectedState}
					key={option.label}
					onClick={() => onSelectedStateChange(option.value)}
					size="sm"
					variant={option.value === selectedState ? 'secondary' : 'ghost'}
				>
					{option.label}
				</Button>
			))}
		</fieldset>
	)
}

import type { PullRequestDraftFilter } from '@repo/contracts'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'

/** A select needs a value for "no filter", which the contract expresses by omission. */
const ANY_DRAFT_STATE = 'all'

interface PullRequestDraftFilterOption {
	label: string
	/** Prefixed, because "All" alone reads as the state filter beside it. */
	triggerLabel: string
	value: PullRequestDraftFilter | typeof ANY_DRAFT_STATE
}

const PULL_REQUEST_DRAFT_FILTER_OPTIONS: PullRequestDraftFilterOption[] = [
	{ label: 'All', triggerLabel: 'Draft: all', value: ANY_DRAFT_STATE },
	{ label: 'Drafts only', triggerLabel: 'Draft: only', value: 'only' },
	{
		label: 'Exclude drafts',
		triggerLabel: 'Draft: excluded',
		value: 'exclude',
	},
]

interface PullRequestsDraftFilterProps {
	draft?: PullRequestDraftFilter
	onDraftChange: (draft: PullRequestDraftFilter | undefined) => void
}

export function PullRequestsDraftFilter({
	draft,
	onDraftChange,
}: Readonly<PullRequestsDraftFilterProps>) {
	const selectedValue = draft ?? ANY_DRAFT_STATE
	const selectedOption = PULL_REQUEST_DRAFT_FILTER_OPTIONS.find(
		option => option.value === selectedValue
	)

	function handleValueChange(value: string | null) {
		const option = PULL_REQUEST_DRAFT_FILTER_OPTIONS.find(
			candidate => candidate.value === value
		)

		if (!option) return

		onDraftChange(option.value === ANY_DRAFT_STATE ? undefined : option.value)
	}

	return (
		<Select onValueChange={handleValueChange} value={selectedValue}>
			<SelectTrigger
				aria-label="Filter pull requests by draft state"
				className="justify-between"
			>
				<SelectValue>{selectedOption?.triggerLabel}</SelectValue>
			</SelectTrigger>
			<SelectContent align="start">
				{PULL_REQUEST_DRAFT_FILTER_OPTIONS.map(option => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	)
}

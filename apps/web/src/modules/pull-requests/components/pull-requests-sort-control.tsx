import type { PullRequestSort, PullRequestSortDirection } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@repo/ui/components/select'
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'

interface PullRequestSortOption {
	label: string
	value: PullRequestSort
}

const PULL_REQUEST_SORT_OPTIONS: PullRequestSortOption[] = [
	{ label: 'Created', value: 'created' },
	{ label: 'Updated', value: 'updated' },
	{ label: 'Recent activity', value: 'activity' },
]

interface PullRequestsSortControlProps {
	sort: PullRequestSort
	direction: PullRequestSortDirection
	onSortChange: (sort: PullRequestSort) => void
	onDirectionChange: (direction: PullRequestSortDirection) => void
}

/** Every sort is a date, so the direction is named by what it puts on top. */
export function PullRequestsSortControl({
	sort,
	direction,
	onSortChange,
	onDirectionChange,
}: Readonly<PullRequestsSortControlProps>) {
	const isNewestFirst = direction === 'desc'
	const directionLabel = isNewestFirst
		? 'Sort oldest first'
		: 'Sort newest first'
	const selectedOption = PULL_REQUEST_SORT_OPTIONS.find(
		option => option.value === sort
	)

	function handleValueChange(value: string | null) {
		const option = PULL_REQUEST_SORT_OPTIONS.find(
			candidate => candidate.value === value
		)

		if (option) onSortChange(option.value)
	}

	return (
		<div className="flex items-center gap-1">
			<Select onValueChange={handleValueChange} value={sort}>
				<SelectTrigger
					aria-label="Sort pull requests"
					className="justify-between"
				>
					<SelectValue>{`Sort: ${selectedOption?.label}`}</SelectValue>
				</SelectTrigger>
				<SelectContent align="start">
					{PULL_REQUEST_SORT_OPTIONS.map(option => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Button
				aria-label={directionLabel}
				onClick={() => onDirectionChange(isNewestFirst ? 'asc' : 'desc')}
				size="icon"
				title={directionLabel}
				type="button"
				variant="outline"
			>
				{isNewestFirst ? (
					<ArrowDownWideNarrow aria-hidden />
				) : (
					<ArrowUpNarrowWide aria-hidden />
				)}
			</Button>
		</div>
	)
}

import { PULL_REQUESTS_SEARCH_MAX_LENGTH } from '@repo/contracts'
import { SearchInput } from '@/shared/components/search-input'
import type { PullRequestsListFilters } from '../helpers/pull-requests-list-search'
import { PullRequestsDraftFilter } from './pull-requests-draft-filter'
import { PullRequestsSortControl } from './pull-requests-sort-control'

interface PullRequestsListControlsProps {
	filters: PullRequestsListFilters
	onFiltersChange: (filters: Partial<PullRequestsListFilters>) => void
}

/** Search takes the room left over; the selects wrap beneath it when there is none. */
export function PullRequestsListControls({
	filters,
	onFiltersChange,
}: Readonly<PullRequestsListControlsProps>) {
	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
			<SearchInput
				label="Search pull requests"
				maxLength={PULL_REQUESTS_SEARCH_MAX_LENGTH}
				onQueryChange={q => onFiltersChange({ q })}
				placeholder="Search by number, title, branch, or author"
				query={filters.q ?? ''}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<PullRequestsDraftFilter
					draft={filters.draft}
					onDraftChange={draft => onFiltersChange({ draft })}
				/>
				<PullRequestsSortControl
					direction={filters.direction}
					onDirectionChange={direction => onFiltersChange({ direction })}
					onSortChange={sort => onFiltersChange({ sort })}
					sort={filters.sort}
				/>
			</div>
		</div>
	)
}

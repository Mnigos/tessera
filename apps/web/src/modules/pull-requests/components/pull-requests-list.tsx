import type { PullRequestListItem as PullRequestListItemData } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { canWriteRepository } from '@/modules/repositories/helpers/repository-viewer-role'
import {
	PULL_REQUESTS_LIST_DEFAULT_FILTERS,
	type PullRequestsListFilters,
	type PullRequestsListSearch,
	toListPullRequestsInput,
} from '../helpers/pull-requests-list-search'
import { usePullRequestsListQuery } from '../hooks/use-pull-requests-list.query'
import { NewPullRequestLink } from './new-pull-request-link'
import { PullRequestListItem } from './pull-request-list-item'
import { PullRequestsListControls } from './pull-requests-list-controls'
import { PullRequestsMessage } from './pull-requests-message'
import { PullRequestsPagination } from './pull-requests-pagination'
import { PullRequestsStateFilter } from './pull-requests-state-filter'

interface PullRequestsListProps {
	username: string
	slug: string
	search: PullRequestsListSearch
	onFiltersChange: (filters: Partial<PullRequestsListFilters>) => void
	onPageChange: (cursor: string | undefined) => void
}

export function PullRequestsList({
	username,
	slug,
	search,
	onFiltersChange,
	onPageChange,
}: Readonly<PullRequestsListProps>) {
	const { data, isError, isLoading, isPlaceholderData } =
		usePullRequestsListQuery(toListPullRequestsInput(username, slug, search))
	const canCreatePullRequest =
		canWriteRepository(data?.viewerRole) && data?.authority !== 'github'

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<PullRequestsStateFilter
						onSelectedStateChange={state => onFiltersChange({ state })}
						selectedState={search.state}
					/>
					{canCreatePullRequest && (
						<NewPullRequestLink slug={slug} username={username} />
					)}
				</div>
				<PullRequestsListControls
					filters={search}
					onFiltersChange={onFiltersChange}
				/>
			</header>
			{/* The rows already on screen stay put while the next page loads, so a
			    keystroke never collapses the list back to a skeleton. */}
			<div
				aria-busy={isPlaceholderData}
				className={cn(
					'flex flex-col gap-4 transition-opacity duration-150',
					isPlaceholderData && 'opacity-60'
				)}
			>
				<PullRequestsListContent
					canCreatePullRequest={canCreatePullRequest}
					hasAnyPullRequests={data?.hasAnyPullRequests}
					isError={isError}
					isLoading={isLoading}
					onClearFilters={() =>
						onFiltersChange(PULL_REQUESTS_LIST_DEFAULT_FILTERS)
					}
					pullRequests={data?.pullRequests}
					slug={slug}
					username={username}
				/>
				<PullRequestsPagination
					busy={isPlaceholderData}
					cursor={search.cursor}
					nextCursor={data?.nextCursor}
					onPageChange={onPageChange}
				/>
			</div>
		</section>
	)
}

interface PullRequestsListContentProps {
	username: string
	slug: string
	isError: boolean
	isLoading: boolean
	canCreatePullRequest: boolean
	hasAnyPullRequests?: boolean
	onClearFilters: () => void
	pullRequests?: PullRequestListItemData[]
}

function PullRequestsListContent({
	username,
	slug,
	isError,
	isLoading,
	canCreatePullRequest,
	hasAnyPullRequests,
	onClearFilters,
	pullRequests,
}: Readonly<PullRequestsListContentProps>) {
	if (isLoading) return <PullRequestsListLoadingState />

	if (isError)
		return (
			<PullRequestsMessage
				description="The pull requests for this repository could not be loaded."
				title="Pull requests could not be loaded"
			/>
		)

	if (!pullRequests)
		return (
			<PullRequestsMessage
				description="The pull request list returned no data."
				title="Pull requests are unavailable"
			/>
		)

	// An empty repository and an empty result look alike, so the answer to
	// "is there anything here at all" is what decides which one is said.
	if (pullRequests.length === 0 && hasAnyPullRequests)
		return (
			<PullRequestsMessage
				action={
					<Button onClick={onClearFilters} size="sm" variant="outline">
						Clear filters
					</Button>
				}
				description="No pull request in this repository matches the current search and filters."
				title="No pull requests match"
			/>
		)

	if (pullRequests.length === 0)
		return (
			<PullRequestsMessage
				action={
					canCreatePullRequest ? (
						<NewPullRequestLink slug={slug} username={username} />
					) : undefined
				}
				description="Open a pull request to propose changes from one branch into another."
				title="No pull requests yet"
			/>
		)

	return (
		<Card className="gap-0 divide-y divide-border p-0">
			<ul className="divide-y divide-border">
				{pullRequests.map(pullRequest => (
					<PullRequestListItem
						key={pullRequest.id}
						pullRequest={pullRequest}
						slug={slug}
						username={username}
					/>
				))}
			</ul>
		</Card>
	)
}

function PullRequestsListLoadingState() {
	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{PULL_REQUEST_LOADING_ROWS.map(row => (
				<div className="flex flex-col gap-2 px-4 py-4" key={row}>
					<div className="h-4 max-w-lg animate-pulse rounded bg-muted" />
					<div className="h-3 max-w-sm animate-pulse rounded bg-muted/70" />
				</div>
			))}
		</Card>
	)
}

const PULL_REQUEST_LOADING_ROWS = ['pull-1', 'pull-2', 'pull-3']

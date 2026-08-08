import type {
	PullRequestListItem as PullRequestListItemData,
	PullRequestState,
} from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Link } from '@tanstack/react-router'
import { GitPullRequest, Plus } from 'lucide-react'
import { canWriteRepository } from '@/modules/repositories/helpers/repository-viewer-role'
import { usePullRequestsListQuery } from '../hooks/use-pull-requests-list.query'
import { PullRequestListItem } from './pull-request-list-item'
import { PullRequestsMessage } from './pull-requests-message'
import { PullRequestsStateFilter } from './pull-requests-state-filter'

interface PullRequestsListProps {
	username: string
	slug: string
	selectedState?: PullRequestState
	onSelectedStateChange: (state?: PullRequestState) => void
}

export function PullRequestsList({
	username,
	slug,
	selectedState,
	onSelectedStateChange,
}: Readonly<PullRequestsListProps>) {
	const { data, isError, isLoading } = usePullRequestsListQuery({
		username,
		slug,
		state: selectedState,
	})

	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<p className="truncate text-muted-foreground text-sm">
						{username}/{slug}
					</p>
					<h1 className="font-semibold text-3xl tracking-normal">
						Pull requests
					</h1>
				</div>
				{canWriteRepository(data?.viewerRole) &&
					data?.authority !== 'github' && (
						<Link
							className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-xs transition-colors hover:bg-primary/90"
							params={{ username, slug }}
							to="/$username/$slug/pulls/new"
						>
							<Plus aria-hidden className="size-4" />
							New pull request
						</Link>
					)}
			</header>
			<PullRequestsStateFilter
				onSelectedStateChange={onSelectedStateChange}
				selectedState={selectedState}
			/>
			<PullRequestsListContent
				isError={isError}
				isLoading={isLoading}
				pullRequests={data?.pullRequests}
				slug={slug}
				username={username}
			/>
		</section>
	)
}

interface PullRequestsListContentProps {
	username: string
	slug: string
	isError: boolean
	isLoading: boolean
	pullRequests?: PullRequestListItemData[]
}

function PullRequestsListContent({
	username,
	slug,
	isError,
	isLoading,
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

	if (pullRequests.length === 0)
		return (
			<Card className="flex flex-col items-center gap-2 p-8 text-center">
				<GitPullRequest aria-hidden className="size-6 text-muted-foreground" />
				<p className="text-muted-foreground text-sm">
					No pull requests match this filter.
				</p>
			</Card>
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

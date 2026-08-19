import { createFileRoute } from '@tanstack/react-router'
import { RepositoryBrowserMessage } from '../components/repository-browser-message'
import { RepositoryOverview } from '../components/repository-overview'
import { isRepositoryNotReadyError } from '../helpers/repository-storage-readiness'
import { useRepositoryBrowserSummaryQuery } from '../hooks/use-repository-browser-summary.query'

export const Route = createFileRoute('/$username/$slug/')({
	component: RepositoryOverviewRoute,
})

function RepositoryOverviewRoute() {
	const { username, slug } = Route.useParams()
	const { ref } = Route.useSearch()
	const {
		data: summary,
		error,
		isLoading,
		isError,
	} = useRepositoryBrowserSummaryQuery({ ref, slug, username })

	if (isLoading)
		return (
			<div className="flex flex-col gap-4">
				<div className="h-10 max-w-lg animate-pulse rounded-md bg-secondary" />
				<div className="h-24 animate-pulse rounded-md bg-secondary/50" />
			</div>
		)

	if (isError)
		return (
			<RepositoryBrowserMessage
				title={
					isRepositoryNotReadyError(error)
						? 'Repository is not ready'
						: 'Repository could not be loaded'
				}
			>
				{isRepositoryNotReadyError(error)
					? 'This repository exists, but its Git data is not available yet. Try again after the import finishes.'
					: 'The repository overview could not be loaded.'}
			</RepositoryBrowserMessage>
		)

	if (!summary)
		return (
			<RepositoryBrowserMessage title="Repository has no overview data">
				The repository overview returned no data.
			</RepositoryBrowserMessage>
		)

	return <RepositoryOverview selectedRef={ref} summary={summary} />
}

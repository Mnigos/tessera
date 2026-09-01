import { Button } from '@repo/ui/components/button'
import { formatRepositoryCount } from '../helpers/format-repository-count'

const SENTINEL_OPTIONS = { rootMargin: '200px 0px' }

interface GitHubImportLoadStatusProps {
	hasLoadMoreError: boolean
	hasNextPage: boolean
	isFetchingNextPage: boolean
	isSearching: boolean
	loadedCount: number
	onLoadMore: () => void
	pageCount: number
	query: string
}

function getStatusText({
	hasLoadMoreError,
	hasNextPage,
	isFetchingNextPage,
	isSearching,
	loadedCount,
}: Omit<GitHubImportLoadStatusProps, 'onLoadMore' | 'pageCount' | 'query'>) {
	if (hasLoadMoreError) return 'Loading more failed.'
	if (isSearching) return 'Searching...'
	if (loadedCount === 0) return 'No matches yet. Scanning more repositories...'

	const loaded = formatRepositoryCount(loadedCount)

	if (isFetchingNextPage) return `${loaded} loaded. Loading more...`
	if (hasNextPage) return `${loaded} loaded. Scroll for more.`

	return `All ${loaded} loaded.`
}

export function GitHubImportLoadStatus(
	props: Readonly<GitHubImportLoadStatusProps>
) {
	const { hasLoadMoreError, hasNextPage, onLoadMore, pageCount, query } = props

	function observeSentinel(node: HTMLDivElement | null) {
		if (!node) return

		const observer = new IntersectionObserver(entries => {
			if (entries.some(entry => entry.isIntersecting)) onLoadMore()
		}, SENTINEL_OPTIONS)

		observer.observe(node)

		return () => observer.disconnect()
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-3 text-muted-foreground text-sm">
				<p aria-live="polite">{getStatusText(props)}</p>
				{hasLoadMoreError && (
					<Button onClick={onLoadMore} size="sm" variant="ghost">
						Retry
					</Button>
				)}
			</div>
			{/* Keyed per fetched page and search so a still-visible sentinel re-observes, even when a page added no matches. */}
			{hasNextPage && (
				<div
					aria-hidden
					className="h-px"
					key={`${query}:${pageCount}`}
					ref={observeSentinel}
				/>
			)}
		</div>
	)
}

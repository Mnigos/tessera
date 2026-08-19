import { Button } from '@repo/ui/components/button'
import { RefreshCw } from 'lucide-react'
import { formatPullRequestDate } from '../helpers/pull-request-formatting'
import { usePullRequestActivityQuery } from '../hooks/use-pull-request-activity.query'
import { useRefreshPullRequestGitHubMutation } from '../hooks/use-refresh-pull-request-github.mutation'

interface PullRequestGitHubRefreshProps {
	username: string
	slug: string
	number: string
}

/**
 * Asks GitHub for this conversation now. Drawn only while GitHub still feeds the
 * pull request, and disabled while a reconciliation is already outstanding —
 * which the activity poll clears, so no timer here decides when it comes back.
 */
export function PullRequestGitHubRefresh({
	username,
	slug,
	number,
}: Readonly<PullRequestGitHubRefreshProps>) {
	// The page is already polling this; asking again shares that one query.
	const activityQuery = usePullRequestActivityQuery({ username, slug, number })
	const refreshMutation = useRefreshPullRequestGitHubMutation()

	const mirror = activityQuery.data?.mirror

	if (!mirror) return null

	const isSyncing =
		refreshMutation.isPending ||
		mirror.requestedSyncVersion > mirror.projectedSyncVersion

	return (
		<Button
			disabled={isSyncing}
			onClick={() => refreshMutation.mutate({ username, slug, number })}
			size="sm"
			title={
				mirror.lastSyncedAt
					? `Last synchronized from GitHub ${formatPullRequestDate(mirror.lastSyncedAt)}`
					: 'Not yet synchronized from GitHub'
			}
			variant="outline"
		>
			<RefreshCw aria-hidden className="size-4" />
			{isSyncing ? 'Refreshing…' : 'Refresh from GitHub'}
		</Button>
	)
}

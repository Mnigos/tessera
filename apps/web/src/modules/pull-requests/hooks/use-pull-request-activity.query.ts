import type { GetPullRequestInput, PullRequestActivity } from '@repo/contracts'
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/** The only poll in the application; everything else waits to be told it is stale. */
const PULL_REQUEST_ACTIVITY_POLL_MS = 15_000

/**
 * Polls the activity cursor and reloads exactly what moved. The comparison lives
 * in the query function, against the cached cursor: that baseline survives
 * hydration and remounting, and a first read has nothing to compare against.
 */
export function usePullRequestActivityQuery(
	input: GetPullRequestInput,
	enabled = true
) {
	const queryClient = useQueryClient()
	const activityOptions = orpcQuery.pullRequests.activity.queryOptions({
		input,
	})

	return useQuery({
		...activityOptions,
		enabled,
		queryFn: async context => {
			const previous = queryClient.getQueryData<PullRequestActivity>(
				context.queryKey
			)
			const activity = await activityOptions.queryFn(context)

			if (previous)
				await reloadMovedQueries({ activity, input, previous, queryClient })

			return activity
		},
		refetchInterval: PULL_REQUEST_ACTIVITY_POLL_MS,
		// A page nobody is looking at has nothing to keep fresh.
		refetchIntervalInBackground: false,
		staleTime: 0,
	})
}

async function reloadMovedQueries({
	activity,
	input,
	previous,
	queryClient,
}: {
	activity: PullRequestActivity
	input: GetPullRequestInput
	previous: PullRequestActivity
	queryClient: QueryClient
}): Promise<void> {
	const headMoved = previous.headSha !== activity.headSha
	const threadsMoved =
		hasMoved(previous.threadsUpdatedAt, activity.threadsUpdatedAt) ||
		previous.commentCount !== activity.commentCount ||
		previous.unresolvedThreadCount !== activity.unresolvedThreadCount
	const reviewsMoved =
		hasMoved(previous.reviewsUpdatedAt, activity.reviewsUpdatedAt) ||
		hasMoved(previous.eventsUpdatedAt, activity.eventsUpdatedAt)
	const checksMoved = hasMoved(
		previous.checksUpdatedAt,
		activity.checksUpdatedAt
	)
	const reloads: Promise<void>[] = []
	const reload = (queryKey: readonly unknown[]) => {
		reloads.push(queryClient.invalidateQueries({ queryKey }))
	}

	if (threadsMoved || headMoved)
		reload(orpcQuery.pullRequests.listThreads.key({ input }))

	if (reviewsMoved || checksMoved || headMoved)
		reload(orpcQuery.pullRequests.get.key({ input }))

	if (threadsMoved || reviewsMoved || headMoved)
		reload(orpcQuery.pullRequests.getMergeRequirements.key({ input }))

	// Everything keyed to a commit — file diffs, viewed ticks, checks — takes its
	// commit from the comparison, so reloading that one read re-keys the rest.
	if (headMoved) reload(orpcQuery.pullRequests.comparison.key({ input }))

	if (checksMoved) reload(orpcQuery.pullRequests.listChecks.key({ input }))

	await Promise.all(reloads)
}

function hasMoved(previous?: Date, next?: Date): boolean {
	return previous?.getTime() !== next?.getTime()
}

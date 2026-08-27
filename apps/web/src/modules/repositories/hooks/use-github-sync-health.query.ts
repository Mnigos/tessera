import type {
	GetGitHubSyncHealthInput,
	RepositorySyncHealth,
} from '@repo/contracts'
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/** Fast enough to watch a run move, slow enough to cost nothing while one does. */
const ACTIVE_SYNC_POLL_MS = 3000

/** States describing work that is moving right now, which are worth watching. */
function isSyncActive(syncHealth?: RepositorySyncHealth): boolean {
	return syncHealth?.state === 'pending' || syncHealth?.state === 'partial'
}

/**
 * How synchronization is doing. Derived from operational rows only the owner
 * may read, so callers pass `enabled` rather than letting every viewer issue a
 * request the server would refuse.
 *
 * While a run is underway the query watches it, and the moment it settles the
 * pull request and repository reads are invalidated — the page repaints with
 * what the run brought back instead of resolving into a stale view.
 */
export function useGitHubSyncHealthQuery(
	input: GetGitHubSyncHealthInput,
	enabled = true
) {
	const queryClient = useQueryClient()
	const options = getGitHubSyncHealthQueryOptions(input, enabled)

	return useQuery({
		...options,
		queryFn: async context => {
			const previous = queryClient.getQueryData<{
				syncHealth?: RepositorySyncHealth
			}>(context.queryKey)
			const result = await options.queryFn(context)

			if (
				isSyncActive(previous?.syncHealth) &&
				!isSyncActive(result.syncHealth)
			)
				await invalidateSyncedReads(queryClient)

			return result
		},
		refetchInterval: query =>
			isSyncActive(query.state.data?.syncHealth) ? ACTIVE_SYNC_POLL_MS : false,
	})
}

/** Everything a reconciliation may have rewritten, reloaded together. */
async function invalidateSyncedReads(queryClient: QueryClient): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({ queryKey: orpcQuery.pullRequests.key() }),
		queryClient.invalidateQueries({ queryKey: orpcQuery.repositories.key() }),
	])
}

export function getGitHubSyncHealthQueryOptions(
	input: GetGitHubSyncHealthInput,
	enabled = true
) {
	return orpcQuery.repositories.getGitHubSyncHealth.queryOptions({
		input,
		enabled,
	})
}

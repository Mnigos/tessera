import type { GetGitHubSyncHealthInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * How synchronization is doing. Derived from operational rows only the owner
 * may read, so callers pass `enabled` rather than letting every viewer issue a
 * request the server would refuse.
 */
export function useGitHubSyncHealthQuery(
	input: GetGitHubSyncHealthInput,
	enabled = true
) {
	return useQuery(getGitHubSyncHealthQueryOptions(input, enabled))
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

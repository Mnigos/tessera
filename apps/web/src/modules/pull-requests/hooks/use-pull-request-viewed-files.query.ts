import type { ListPullRequestViewedFilesInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function usePullRequestViewedFilesQuery(
	input: ListPullRequestViewedFilesInput,
	enabled = true
) {
	return useQuery(
		orpcQuery.pullRequests.listViewedFiles.queryOptions({
			input,
			enabled,
		})
	)
}

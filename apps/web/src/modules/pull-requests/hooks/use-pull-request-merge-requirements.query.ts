import type { GetPullRequestInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * Whether this pull request may be merged right now, and if not, why.
 *
 * The answer is advisory: merging re-evaluates everything server-side and can
 * still refuse. What it is good for is telling the reader what stands in the
 * way before they press anything.
 */
export function usePullRequestMergeRequirementsQuery(
	input: GetPullRequestInput,
	enabled = true
) {
	return useQuery(
		orpcQuery.pullRequests.getMergeRequirements.queryOptions({
			input,
			enabled,
		})
	)
}

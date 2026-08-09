import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * Everything an open pull request derives from its target branch. The row moved,
 * so the diff, the threads anchored inside it, the checks rolled up beside it
 * and what the merge panel is willing to offer are all describing a base the
 * pull request no longer has.
 */
function getRetargetInvalidatedQueryKeys() {
	return [
		orpcQuery.pullRequests.list.key(),
		orpcQuery.pullRequests.get.key(),
		orpcQuery.pullRequests.comparison.key(),
		orpcQuery.pullRequests.reviewComparison.key(),
		orpcQuery.pullRequests.fileDiff.key(),
		orpcQuery.pullRequests.listThreads.key(),
		orpcQuery.pullRequests.listChecks.key(),
		orpcQuery.pullRequests.getMergeRequirements.key(),
	]
}

export function useRetargetPullRequestMutation() {
	const queryClient = useQueryClient()

	return useMutation(
		orpcQuery.pullRequests.retarget.mutationOptions({
			// Not awaited: React Query holds the mutation's own result until a
			// promise returned from here settles, and the dialog that asked for the
			// move closes on that result. Eight refetches must not decide when the
			// user is told their pull request moved.
			onSuccess: () => {
				for (const queryKey of getRetargetInvalidatedQueryKeys())
					void queryClient.invalidateQueries({ queryKey })
			},
		})
	)
}

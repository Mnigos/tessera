import type { GetPullRequestInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc/client'

/**
 * How often the open pull request asks GitHub for its conversation. Webhooks
 * carry changes the moment they happen; this only repairs the ones a mirror
 * missed, and the server throttles per pull request besides.
 */
const GITHUB_AUTO_REFRESH_INTERVAL_MS = 90_000

/**
 * Keeps a mirrored pull request fresh without anyone asking: once on arrival,
 * again whenever the window regains focus, and on a slow interval in between.
 * The refresh only wakes the ordinary reconciliation — the activity poll is
 * what reports whatever it brings back, so there is nothing to render here.
 */
export function usePullRequestGitHubAutoRefresh(
	input: GetPullRequestInput,
	enabled: boolean
) {
	useQuery({
		enabled,
		queryKey: ['pull-request-github-auto-refresh', input],
		queryFn: () => orpc.pullRequests.refreshGitHub(input),
		refetchInterval: GITHUB_AUTO_REFRESH_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: 'always',
		// Remounts within the page must not count as new arrivals.
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}

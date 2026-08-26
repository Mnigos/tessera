import type { PullRequestThread } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * The lines a thread's anchor covers, read from the commits the anchor pinned —
 * they outlive the diff, so an outdated thread still shows its code. Only a
 * range asks; a single line already carries its stored excerpt.
 */
export function usePullRequestThreadExcerptQuery(
	{
		username,
		slug,
		number,
		anchor,
	}: {
		username: string
		slug: string
		number: string
		anchor: NonNullable<PullRequestThread['anchor']>
	},
	enabled: boolean
) {
	return useQuery({
		...orpcQuery.pullRequests.fileLines.queryOptions({
			input: {
				username,
				slug,
				number,
				path: anchor.path,
				expectedBaseSha: anchor.baseSha,
				expectedHeadSha: anchor.headSha,
				side: anchor.side,
				startLine: anchor.startLine,
				endLine: anchor.endLine,
			},
		}),
		enabled,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}

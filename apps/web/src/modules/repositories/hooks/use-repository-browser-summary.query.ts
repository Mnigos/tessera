import { getRepositoryBrowserSummaryInputSchema } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import type { z } from 'zod'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryBrowserSummaryQuery({
	ref,
	slug,
	username,
}: z.input<typeof getRepositoryBrowserSummaryInputSchema>) {
	return useQuery(
		orpcQuery.repositories.getBrowserSummary.queryOptions({
			input: getRepositoryBrowserSummaryInputSchema.parse({
				ref,
				slug,
				username,
			}),
		})
	)
}

import { getRepositoryInputSchema } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import type { z } from 'zod'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryQuery({
	slug,
	username,
}: z.input<typeof getRepositoryInputSchema>) {
	return useQuery(
		orpcQuery.repositories.get.queryOptions({
			input: getRepositoryInputSchema.parse({ username, slug }),
		})
	)
}

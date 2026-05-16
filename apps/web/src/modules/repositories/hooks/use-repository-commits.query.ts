import type { GetRepositoryCommitHistoryInput } from '@repo/contracts'
import { getRepositoryCommitHistoryInputSchema } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export interface RepositoryCommitsInput
	extends Omit<GetRepositoryCommitHistoryInput, 'slug'> {
	slug: string
}

export function useRepositoryCommitsQuery(input: RepositoryCommitsInput) {
	return useQuery(getRepositoryCommitsQueryOptions(input))
}

export function getRepositoryCommitsQueryOptions(
	input: RepositoryCommitsInput
) {
	return orpcQuery.repositories.getCommitHistory.queryOptions({
		input: getRepositoryCommitHistoryInputSchema.parse(input),
	})
}

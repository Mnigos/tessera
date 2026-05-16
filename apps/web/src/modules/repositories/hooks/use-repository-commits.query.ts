import type { GetRepositoryCommitHistoryInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryCommitsQuery(
	input: GetRepositoryCommitHistoryInput
) {
	return useQuery(getRepositoryCommitsQueryOptions(input))
}

export function getRepositoryCommitsQueryOptions(
	input: GetRepositoryCommitHistoryInput
) {
	return orpcQuery.repositories.getCommitHistory.queryOptions({
		input,
	})
}

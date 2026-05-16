import type { RepositoryCommitHistory } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export type RepositoryCommitsResult = RepositoryCommitHistory
export type RepositoryCommit = RepositoryCommitHistory['commits'][number]

export interface RepositoryCommitsInput {
	username: string
	slug: string
	ref: string
}

export function useRepositoryCommitsQuery(input: RepositoryCommitsInput) {
	return useQuery(getRepositoryCommitsQueryOptions(input))
}

export function getRepositoryCommitsQueryOptions(
	input: RepositoryCommitsInput
) {
	return orpcQuery.repositories.getCommitHistory.queryOptions({
		input,
	})
}

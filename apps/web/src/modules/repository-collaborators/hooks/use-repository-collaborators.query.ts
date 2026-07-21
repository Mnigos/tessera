import type { ListRepositoryCollaboratorsInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryCollaboratorsQuery(
	input: ListRepositoryCollaboratorsInput
) {
	return useQuery(getRepositoryCollaboratorsQueryOptions(input))
}

export function getRepositoryCollaboratorsQueryOptions(
	input: ListRepositoryCollaboratorsInput
) {
	return orpcQuery.repositoryCollaborators.list.queryOptions({
		input,
	})
}

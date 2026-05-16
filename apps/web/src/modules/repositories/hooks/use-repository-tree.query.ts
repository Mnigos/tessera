import type { GetRepositoryTreeInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryTreeQuery(input: GetRepositoryTreeInput) {
	return useQuery(getRepositoryTreeQueryOptions(input))
}

export function getRepositoryTreeQueryOptions(input: GetRepositoryTreeInput) {
	return orpcQuery.repositories.getTree.queryOptions({
		input,
	})
}

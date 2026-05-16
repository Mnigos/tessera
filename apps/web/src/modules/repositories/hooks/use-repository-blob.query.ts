import type { GetRepositoryBlobInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useRepositoryBlobQuery(input: GetRepositoryBlobInput) {
	return useQuery(getRepositoryBlobQueryOptions(input))
}

export function getRepositoryBlobQueryOptions(input: GetRepositoryBlobInput) {
	return orpcQuery.repositories.getBlob.queryOptions({
		input,
	})
}

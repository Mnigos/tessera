import type { GetRepositoryTreeInput } from '@repo/contracts'
import { getRepositoryTreeInputSchema } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export interface RepositoryTreePathInput
	extends Omit<GetRepositoryTreeInput, 'slug'> {
	slug: string
}

export function useRepositoryTreeQuery(input: RepositoryTreePathInput) {
	return useQuery(getRepositoryTreeQueryOptions(input))
}

export function getRepositoryTreeQueryOptions(input: RepositoryTreePathInput) {
	return orpcQuery.repositories.getTree.queryOptions({
		input: getRepositoryTreeInput(input),
	})
}

function getRepositoryTreeInput({
	username,
	slug,
	ref,
	path,
}: RepositoryTreePathInput) {
	return getRepositoryTreeInputSchema.parse({
		username,
		slug,
		ref,
		path: path || undefined,
	})
}

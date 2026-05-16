import type { GetRepositoryBlobInput } from '@repo/contracts'
import { getRepositoryBlobInputSchema } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export interface RepositoryBlobPathInput
	extends Omit<GetRepositoryBlobInput, 'slug'> {
	slug: string
}

export function useRepositoryBlobQuery(input: RepositoryBlobPathInput) {
	return useQuery(getRepositoryBlobQueryOptions(input))
}

export function getRepositoryBlobQueryOptions(input: RepositoryBlobPathInput) {
	return orpcQuery.repositories.getBlob.queryOptions({
		input: getRepositoryBlobInput(input),
	})
}

function getRepositoryBlobInput({
	username,
	slug,
	ref,
	path,
}: RepositoryBlobPathInput) {
	return getRepositoryBlobInputSchema.parse({
		username,
		slug,
		ref,
		path,
	})
}

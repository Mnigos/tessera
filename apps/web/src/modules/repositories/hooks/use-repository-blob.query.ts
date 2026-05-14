import type { RepositoryBlob } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export type RepositoryBlobResult = RepositoryBlob

export interface RepositoryBlobPathInput {
	username: string
	slug: string
	ref: string
	path: string
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
	return {
		username,
		slug,
		ref,
		path,
	}
}

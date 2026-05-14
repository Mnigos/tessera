import type { RepositoryTree } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export type RepositoryTreeResult = RepositoryTree

export interface RepositoryTreePathInput {
	username: string
	slug: string
	ref: string
	path?: string
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
	return {
		username,
		slug,
		ref,
		path: path || undefined,
	}
}

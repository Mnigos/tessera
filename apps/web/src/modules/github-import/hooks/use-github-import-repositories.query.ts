import type { ListGitHubImportRepositoriesInput } from '@repo/contracts'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGitHubImportRepositoriesQuery(
	input: Pick<ListGitHubImportRepositoriesInput, 'search'>,
	enabled: boolean
) {
	return useInfiniteQuery(
		orpcQuery.githubImport.listRepositories.infiniteOptions({
			enabled,
			getNextPageParam: lastPage => lastPage.nextPage,
			initialPageParam: 1,
			input: pageParam => ({ page: pageParam, search: input.search }),
			placeholderData: keepPreviousData,
		})
	)
}

import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGitHubImportRepositoriesQuery(enabled: boolean) {
	return useQuery(
		orpcQuery.githubImport.listRepositories.queryOptions({ enabled })
	)
}

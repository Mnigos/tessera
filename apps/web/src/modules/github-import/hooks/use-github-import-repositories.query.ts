import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGitHubImportRepositoriesQuery() {
	return useQuery(orpcQuery.githubImport.listRepositories.queryOptions())
}

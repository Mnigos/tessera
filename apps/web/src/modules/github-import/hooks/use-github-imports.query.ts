import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useGitHubImportsQuery(enabled: boolean) {
	return useQuery(
		orpcQuery.githubImport.listImports.queryOptions({
			enabled,
			refetchInterval: query =>
				query.state.data?.imports.some(repositoryImport =>
					['pending', 'running'].includes(repositoryImport.status)
				)
					? 2000
					: false,
		})
	)
}

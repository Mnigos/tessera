import type { GetGitHubReauthorizationInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

/**
 * Where access is granted again, and nothing more. Asking for it never starts a
 * synchronization: GitHub's installation webhook is what resumes one.
 */
export function useGitHubReauthorizationQuery(
	input: GetGitHubReauthorizationInput,
	enabled = true
) {
	return useQuery(
		orpcQuery.repositories.getGitHubReauthorization.queryOptions({
			input,
			enabled,
		})
	)
}

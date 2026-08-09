import type { ListCheckStatusProvidersInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useCheckStatusProvidersQuery(
	input: ListCheckStatusProvidersInput
) {
	return useQuery(getCheckStatusProvidersQueryOptions(input))
}

export function getCheckStatusProvidersQueryOptions(
	input: ListCheckStatusProvidersInput
) {
	return orpcQuery.checks.listStatusProviders.queryOptions({
		input,
	})
}

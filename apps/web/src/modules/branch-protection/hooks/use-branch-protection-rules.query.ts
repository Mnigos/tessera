import type { ListBranchProtectionRulesInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useBranchProtectionRulesQuery(
	input: ListBranchProtectionRulesInput
) {
	return useQuery(getBranchProtectionRulesQueryOptions(input))
}

export function getBranchProtectionRulesQueryOptions(
	input: ListBranchProtectionRulesInput
) {
	return orpcQuery.branchProtection.list.queryOptions({
		input,
	})
}

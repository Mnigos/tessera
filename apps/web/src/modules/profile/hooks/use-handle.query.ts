import type { HandleInput } from '@repo/contracts'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'

export function useHandleQuery(input: HandleInput) {
	return useQuery(orpcQuery.handles.get.queryOptions({ input }))
}

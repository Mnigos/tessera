import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { authClient } from '@/lib/auth/client'
import { orpcQuery } from '@/lib/orpc/query'

export function useAuth() {
	const queryClient = useQueryClient()
	const router = useRouter()
	const sessionQuery = useQuery(
		orpcQuery.auth.session.queryOptions({
			staleTime: 5 * 60 * 1000,
			gcTime: 10 * 60 * 1000,
			refetchOnWindowFocus: true,
			retry: false,
		})
	)

	async function signIn() {
		await authClient.signIn.social({
			provider: 'github',
			callbackURL: `${window.location.origin}/profile`,
		})
	}

	async function signOut() {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: async () => {
					await queryClient.invalidateQueries({
						queryKey: orpcQuery.auth.session.key(),
					})
					await router.invalidate()
					await router.navigate({ to: '/' })
				},
			},
		})
	}

	return {
		user: sessionQuery.data?.user,
		isAuthenticated: !!sessionQuery.data?.user,
		isLoading: sessionQuery.isLoading,
		signIn,
		signOut,
	}
}

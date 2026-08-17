import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { authClient } from '@/lib/auth/client'
import { orpcQuery } from '@/lib/orpc/query'

const DEFAULT_SIGN_IN_CALLBACK_PATH = '/profile'

interface SignInOptions {
	callbackPath?: string
}

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

	async function signIn({ callbackPath }: SignInOptions = {}) {
		await authClient.signIn.social({
			provider: 'github',
			scopes: ['repo'],
			callbackURL: new URL(
				callbackPath ?? DEFAULT_SIGN_IN_CALLBACK_PATH,
				window.location.origin
			).toString(),
		})
	}

	async function signOut() {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: async () => {
					// Every cached query is viewer-scoped, so none of it outlives the session.
					queryClient.clear()
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

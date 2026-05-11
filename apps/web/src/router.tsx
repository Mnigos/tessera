import type { SessionOutput } from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { orpcQuery } from './lib/orpc/query'
import { serializer } from './lib/orpc/serializer'
import { routeTree } from './routeTree.gen'

export interface RouterContext {
	queryClient: QueryClient
	orpc: typeof orpcQuery
	session?: SessionOutput
	user?: SessionOutput['user']
}

function NotFound() {
	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4">
			<h1 className="font-bold text-4xl">404</h1>
			<p className="text-muted-foreground">Page not found</p>
		</div>
	)
}

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				queryKeyHashFn(queryKey) {
					const [json, meta] = serializer.serialize(queryKey)
					return JSON.stringify({ json, meta })
				},
				staleTime: 30_000,
				retry: false,
			},
			dehydrate: {
				shouldDehydrateQuery: query => query.state.status === 'success',
				serializeData(data) {
					const [json, meta] = serializer.serialize(data)
					return { json, meta }
				},
			},
			hydrate: {
				deserializeData(data) {
					const { json, meta } = data as { json: unknown; meta: [] }
					return serializer.deserialize(json, meta)
				},
			},
		},
	})
}

export function getRouter() {
	const queryClient = createQueryClient()

	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreloadStaleTime: 60_000,
		context: { queryClient, orpc: orpcQuery },
		defaultNotFoundComponent: NotFound,
		Wrap: ({ children }) => (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		),
	})

	setupRouterSsrQueryIntegration({ router, queryClient })

	return router
}

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>
	}
}

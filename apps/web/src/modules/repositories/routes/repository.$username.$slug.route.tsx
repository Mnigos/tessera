import { ORPCError, safe } from '@orpc/client'
import { cn } from '@repo/ui/utils'
import {
	createFileRoute,
	notFound,
	Outlet,
	useRouterState,
} from '@tanstack/react-router'
import { z } from 'zod'
import {
	RepositoryHeader,
	RepositoryHeaderSkeleton,
} from '../components/repository-header'
import { isRepositoryNotReadyError } from '../helpers/repository-storage-readiness'
import { useRepositoryBrowserSummaryQuery } from '../hooks/use-repository-browser-summary.query'

const PULL_REQUEST_FILES_ROUTE_ID = '/$username/$slug/pulls/$number/changes'

export const Route = createFileRoute('/$username/$slug')({
	validateSearch: z.object({
		ref: z.string().optional(),
	}),
	loaderDeps: ({ search: { ref } }) => ({ ref }),
	loader: async ({ context, deps: { ref }, params: { username, slug } }) => {
		const [error, repository] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.repositories.getBrowserSummary.queryOptions({
					input: { username, slug, ref },
				})
			)
		)

		if (isRepositoryNotReadyError(error))
			return {
				name: slug,
				slug,
				username,
			}

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		return {
			name: repository.repository.name,
			slug: repository.repository.slug,
			username: repository.owner.handle,
		}
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.username}/${loaderData.slug} · detent`
					: 'Repository · detent',
			},
			{
				name: 'description',
				content: loaderData
					? `${loaderData.name} repository on detent.`
					: 'Repository on detent.',
			},
		],
	}),
	component: RepositoryRoute,
})

function RepositoryRoute() {
	const { username, slug } = Route.useParams()
	const { ref } = Route.useSearch()
	// Files changed is the one page that reads better across the whole viewport.
	const isFullWidth = useRouterState({
		select: state =>
			state.matches.some(
				match => match.routeId === PULL_REQUEST_FILES_ROUTE_ID
			),
	})
	const { data: summary, isLoading } = useRepositoryBrowserSummaryQuery({
		ref,
		slug,
		username,
	})

	return (
		<main
			className={cn(
				'mx-auto flex w-full flex-col gap-3 px-4 py-4 sm:px-6',
				isFullWidth ? 'max-w-none' : 'max-w-6xl'
			)}
		>
			{isLoading && <RepositoryHeaderSkeleton />}
			{summary && <RepositoryHeader selectedRef={ref} summary={summary} />}
			<Outlet />
		</main>
	)
}

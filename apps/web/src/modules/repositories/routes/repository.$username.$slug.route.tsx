import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryOverview } from '../components/repository-overview'
import { useRepositoryBrowserSummaryQuery } from '../hooks/use-repository-browser-summary.query'

export const Route = createFileRoute('/$username/$slug')({
	loader: async ({ context, params }) => {
		const [error, repository] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.repositories.getBrowserSummary.queryOptions({
					input: { username: params.username, slug: params.slug },
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		return {
			name: repository.repository.name,
			slug: repository.repository.slug,
			username: repository.owner.username,
		}
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData
					? `${loaderData.username}/${loaderData.slug} · Tessera`
					: 'Repository · Tessera',
			},
			{
				name: 'description',
				content: loaderData
					? `${loaderData.name} repository on Tessera.`
					: 'Repository on Tessera.',
			},
		],
	}),
	component: RepositoryRoute,
})

function RepositoryRoute() {
	const { username, slug } = Route.useParams()
	const repositoryQuery = useRepositoryBrowserSummaryQuery(username, slug)
	const summary = repositoryQuery.data

	if (repositoryQuery.isLoading)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="flex flex-col gap-4">
					<div className="h-5 max-w-56 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-10 max-w-lg animate-pulse rounded-md bg-secondary" />
					<div className="h-24 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</main>
		)

	if (repositoryQuery.isError)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="border border-border border-dashed p-6 text-muted-foreground text-sm">
					Repository could not be loaded.
				</div>
			</main>
		)

	if (!summary)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="border border-border border-dashed p-6 text-muted-foreground text-sm">
					Repository has no overview data yet.
				</div>
			</main>
		)

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			<RepositoryOverview summary={summary} />
		</main>
	)
}

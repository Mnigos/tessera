import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { RepositoryBrowserMessage } from '../components/repository-browser-message'
import { RepositoryOverview } from '../components/repository-overview'
import { useRepositoryBrowserSummaryQuery } from '../hooks/use-repository-browser-summary.query'

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
	const { ref } = Route.useSearch()
	const {
		data: summary,
		error,
		isLoading,
		isError,
	} = useRepositoryBrowserSummaryQuery({ ref, slug, username })

	if (isLoading)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="flex flex-col gap-4">
					<div className="h-5 max-w-56 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-10 max-w-lg animate-pulse rounded-md bg-secondary" />
					<div className="h-24 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</main>
		)

	if (isError)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<RepositoryBrowserMessage
					title={
						isRepositoryNotReadyError(error)
							? 'Repository is not ready'
							: 'Repository could not be loaded'
					}
				>
					{isRepositoryNotReadyError(error)
						? 'This repository exists, but its Git data is not available yet. Try again after the import finishes.'
						: 'The repository overview could not be loaded.'}
				</RepositoryBrowserMessage>
			</main>
		)

	if (!summary)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<RepositoryBrowserMessage title="Repository has no overview data">
					The repository overview returned no data.
				</RepositoryBrowserMessage>
			</main>
		)

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			<RepositoryOverview selectedRef={ref} summary={summary} />
		</main>
	)
}

function isRepositoryNotReadyError(error: unknown) {
	return (
		error instanceof ORPCError &&
		error.status === 404 &&
		error.message === 'repository not found while storage is being prepared'
	)
}

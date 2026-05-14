import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { RepositoryBlobPreview } from '../components/repository-blob-preview'
import { getRepositoryBlobQueryOptions } from '../hooks/use-repository-blob.query'

export const Route = createFileRoute('/$username/$slug/blob/$ref/$')({
	loader: async ({ context, params }) => {
		const path = params._splat ?? ''
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getRepositoryBlobQueryOptions({
					username: params.username,
					slug: params.slug,
					ref: params.ref,
					path,
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} at ${params.ref}${params._splat ? `/${params._splat}` : ''} · Tessera`,
			},
		],
	}),
	component: RepositoryBlobRoute,
})

function RepositoryBlobRoute() {
	const { username, slug, ref, _splat } = Route.useParams()

	return (
		<main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
			<RepositoryBlobPreview
				path={_splat ?? ''}
				refName={ref}
				slug={slug}
				username={username}
			/>
		</main>
	)
}

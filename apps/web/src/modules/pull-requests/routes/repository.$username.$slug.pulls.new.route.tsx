import { ORPCError, safe } from '@orpc/client'
import type { PullRequest } from '@repo/contracts'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { CreatePullRequestPanel } from '../components/create-pull-request-panel'

export const Route = createFileRoute('/$username/$slug/pulls/new')({
	loader: async ({ context, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.repositories.getRefs.queryOptions({
					input: { username, slug },
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `New pull request · ${params.username}/${params.slug} · detent`,
			},
		],
	}),
	component: NewPullRequestRoute,
})

function NewPullRequestRoute() {
	const { username, slug } = Route.useParams()
	const navigate = Route.useNavigate()

	const handleCreated = (pullRequest: PullRequest) => {
		navigate({
			params: { username, slug, number: String(pullRequest.number) },
			to: '/$username/$slug/pulls/$number',
		})
	}

	return (
		<div className="mx-auto w-full max-w-3xl">
			<CreatePullRequestPanel
				onCreated={handleCreated}
				slug={slug}
				username={username}
			/>
		</div>
	)
}

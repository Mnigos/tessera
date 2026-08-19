import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { BranchProtectionSettings } from '../components/branch-protection-settings'
import { getBranchProtectionRulesQueryOptions } from '../hooks/use-branch-protection-rules.query'

export const Route = createFileRoute(
	'/$username/$slug/settings/branch-protection'
)({
	loader: async ({ context, params: { username, slug } }) => {
		const [error] = await safe(
			context.queryClient.ensureQueryData(
				getBranchProtectionRulesQueryOptions({ username, slug })
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (
			error instanceof ORPCError &&
			(error.status === 401 || error.status === 403)
		)
			return

		if (error) throw error
	},
	head: ({ params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} branch protection · detent`,
			},
		],
	}),
	component: BranchProtectionSettingsRoute,
})

function BranchProtectionSettingsRoute() {
	const { username, slug } = Route.useParams()

	return <BranchProtectionSettings slug={slug} username={username} />
}

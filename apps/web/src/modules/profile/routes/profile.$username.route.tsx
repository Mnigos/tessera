import { ORPCError, safe } from '@orpc/client'
import { Avatar } from '@repo/ui/components/avatar'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useProfileQuery } from '../hooks/use-profile.query'

const NOT_FOUND_STATUSES = [400, 404]

export const Route = createFileRoute('/profile/$username')({
	loader: async ({ context, params }) => {
		const [error, profile] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.user.profile.queryOptions({
					input: { username: params.username },
				})
			)
		)

		if (error instanceof ORPCError && NOT_FOUND_STATUSES.includes(error.status))
			throw notFound()

		if (error) throw error

		return {
			displayName: profile.user.displayName,
			username: profile.user.username,
		}
	},
	head: ({ loaderData }) => ({
		meta: [
			{ title: loaderData ? `${loaderData.displayName} · Tessera` : 'Tessera' },
			{
				name: 'description',
				content: loaderData
					? `${loaderData.displayName}'s Tessera profile.`
					: 'Tessera profile.',
			},
		],
	}),
	component: ProfileUsernameRoute,
})

function ProfileUsernameRoute() {
	const { username } = Route.useParams()
	const profileQuery = useProfileQuery(username)
	const profile = profileQuery.data?.user

	if (profileQuery.isLoading)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="h-24 animate-pulse bg-secondary" />
			</main>
		)

	if (profileQuery.isError || !profile)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="border border-border border-dashed p-6 text-muted-foreground text-sm">
					Profile could not be loaded.
				</div>
			</main>
		)

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			<section className="flex items-center gap-4">
				{profile.avatarUrl ? (
					<img
						alt=""
						className="size-20 rounded-lg"
						height="80"
						src={profile.avatarUrl}
						width="80"
					/>
				) : (
					<Avatar
						className="size-20 rounded-lg"
						displayName={profile.displayName}
						size="lg"
					/>
				)}
				<div className="min-w-0">
					<h1 className="truncate font-semibold text-3xl tracking-normal">
						{profile.displayName}
					</h1>
					<p className="truncate text-muted-foreground">@{profile.username}</p>
				</div>
			</section>
		</main>
	)
}

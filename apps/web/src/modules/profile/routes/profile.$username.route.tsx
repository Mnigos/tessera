import { ORPCError, safe } from '@orpc/client'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { GitAccessTokensSection } from '@/modules/git-access-tokens/components/git-access-tokens-section'
import { CreateRepositorySection } from '@/modules/repositories/components/create-repository-section'
import { useRepositoriesListQuery } from '@/modules/repositories/hooks/use-repositories-list.query'
import {
	ProfileHeader,
	ProfileHeaderSkeleton,
} from '../components/profile-header'
import { ProfileRepositoriesSection } from '../components/profile-repositories-section'
import { useProfileQuery } from '../hooks/use-profile.query'

export const Route = createFileRoute('/profile/$username')({
	loader: async ({ context, params }) => {
		const [error, profile] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.user.profile.queryOptions({
					input: { username: params.username },
				})
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		const { username, displayName } = profile.user

		if (context.user?.username === username)
			await Promise.all([
				context.queryClient.ensureQueryData(
					context.orpc.repositories.list.queryOptions({ input: { username } })
				),
				context.queryClient.ensureQueryData(
					context.orpc.gitAccessTokens.list.queryOptions()
				),
			])

		return {
			displayName,
			username,
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
	const { user } = useAuth()
	const profileQuery = useProfileQuery(username)
	const profile = profileQuery.data?.user
	const isViewerProfile = user?.username === username
	const repositoriesQuery = useRepositoriesListQuery(
		{ username },
		isViewerProfile
	)

	if (profileQuery.isLoading)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<ProfileHeaderSkeleton />
				<div className="mt-10 h-48 animate-pulse rounded-md bg-secondary/60" />
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
			<ProfileHeader profile={profile} />
			{isViewerProfile && (
				<>
					<section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
						<ProfileRepositoriesSection
							isError={repositoriesQuery.isError}
							isLoading={repositoriesQuery.isLoading}
							repositories={repositoriesQuery.data?.repositories ?? []}
							username={username}
						/>
						<CreateRepositorySection username={username} />
					</section>
					<GitAccessTokensSection enabled={isViewerProfile} />
				</>
			)}
		</main>
	)
}

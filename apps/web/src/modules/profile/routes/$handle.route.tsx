import { ORPCError, safe } from '@orpc/client'
import { cn } from '@repo/ui/utils'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { GitAccessTokensSection } from '@/modules/git-access-tokens/components/git-access-tokens-section'
import { GpgPublicKeysSection } from '@/modules/gpg-public-keys/components/gpg-public-keys-section'
import { OrganizationsSection } from '@/modules/organizations/components/organizations-section'
import { CreateRepositorySection } from '@/modules/repositories/components/create-repository-section'
import { SshPublicKeysSection } from '@/modules/ssh-public-keys/components/ssh-public-keys-section'
import { OrganizationHeader } from '../components/organization-header'
import {
	ProfileHeader,
	ProfileHeaderSkeleton,
} from '../components/profile-header'
import { ProfileRepositoriesSection } from '../components/profile-repositories-section'
import { useHandleQuery } from '../hooks/use-handle.query'

export const Route = createFileRoute('/$handle')({
	loader: async ({ context, params: { handle } }) => {
		const [error, profile] = await safe(
			context.queryClient.ensureQueryData(
				context.orpc.handles.get.queryOptions({ input: { handle } })
			)
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		if (profile.owner.kind === 'organization')
			return {
				description: `The ${profile.owner.organization.name} organization on detent.`,
				title: profile.owner.organization.name,
			}

		if (profile.owner.viewerRole === 'self')
			await Promise.all([
				context.queryClient.ensureQueryData(
					context.orpc.gitAccessTokens.list.queryOptions()
				),
				context.queryClient.ensureQueryData(
					context.orpc.sshPublicKeys.list.queryOptions()
				),
				context.queryClient.ensureQueryData(
					context.orpc.gpgPublicKeys.list.queryOptions()
				),
				context.queryClient.ensureQueryData(
					context.orpc.organizations.list.queryOptions()
				),
			])

		return {
			description: `${profile.owner.user.displayName}'s detent profile.`,
			title: profile.owner.user.displayName,
		}
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{ title: `${loaderData?.title ?? params.handle} · detent` },
			{
				name: 'description',
				content: loaderData?.description ?? 'detent profile.',
			},
		],
	}),
	component: HandleRoute,
})

function HandleRoute() {
	const { handle } = Route.useParams()
	const handleQuery = useHandleQuery({ handle })
	const profile = handleQuery.data

	if (handleQuery.isLoading)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<ProfileHeaderSkeleton />
				<div className="mt-10 h-48 animate-pulse rounded-md bg-secondary/60" />
			</main>
		)

	if (handleQuery.isError || !profile)
		return (
			<main className="mx-auto max-w-6xl px-6 py-8">
				<div className="border border-border border-dashed p-6 text-muted-foreground text-sm">
					Profile could not be loaded.
				</div>
			</main>
		)

	const { owner, repositories } = profile
	const isViewerProfile = owner.kind === 'user' && owner.viewerRole === 'self'
	// The resolved handle, not the typed one: links must carry the canonical case.
	const ownerHandle =
		owner.kind === 'user' ? owner.user.username : owner.organization.slug

	return (
		<main className="mx-auto max-w-6xl px-6 py-8">
			{owner.kind === 'user' ? (
				<ProfileHeader profile={owner.user} />
			) : (
				<OrganizationHeader
					organization={owner.organization}
					viewerRole={owner.viewerRole}
				/>
			)}
			<section
				className={cn(
					'mt-10 grid gap-6',
					isViewerProfile && 'lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start'
				)}
			>
				<ProfileRepositoriesSection
					handle={ownerHandle}
					isOwner={isViewerProfile}
					repositories={repositories}
				/>
				{isViewerProfile && <CreateRepositorySection username={ownerHandle} />}
			</section>
			{isViewerProfile && (
				<>
					<OrganizationsSection enabled />
					<GitAccessTokensSection enabled />
					<SshPublicKeysSection enabled />
					<GpgPublicKeysSection enabled />
				</>
			)}
		</main>
	)
}

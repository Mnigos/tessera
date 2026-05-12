import type { PublicUser } from '@repo/contracts'
import { Avatar } from '@repo/ui/components/avatar'

interface ProfileHeaderProps {
	profile: PublicUser
}

export function ProfileHeader({ profile }: Readonly<ProfileHeaderProps>) {
	return (
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
	)
}

export function ProfileHeaderSkeleton() {
	return (
		<section className="flex items-center gap-4">
			<div className="size-20 animate-pulse rounded-lg bg-secondary" />
			<div className="min-w-0 flex-1 space-y-3">
				<div className="h-8 max-w-xs animate-pulse rounded-md bg-secondary" />
				<div className="h-5 max-w-40 animate-pulse rounded-md bg-secondary/70" />
			</div>
		</section>
	)
}

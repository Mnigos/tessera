import type { RepositoryWithOwner } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Link } from '@tanstack/react-router'

interface ProfileRepositoriesSectionProps {
	username: string
	repositories: RepositoryWithOwner[]
	isLoading: boolean
	isError: boolean
}

export function ProfileRepositoriesSection({
	username,
	repositories,
	isLoading,
	isError,
}: Readonly<ProfileRepositoriesSectionProps>) {
	if (isLoading)
		return (
			<section className="flex flex-col gap-3">
				<RepositoryListHeader username={username} />
				<div className="flex flex-col gap-2">
					<div className="h-16 animate-pulse rounded-md bg-secondary/70" />
					<div className="h-16 animate-pulse rounded-md bg-secondary/50" />
				</div>
			</section>
		)

	if (isError)
		return (
			<section className="flex flex-col gap-3">
				<RepositoryListHeader username={username} />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					Repositories could not be loaded.
				</Card>
			</section>
		)

	if (repositories.length === 0)
		return (
			<section className="flex flex-col gap-3">
				<RepositoryListHeader username={username} />
				<Card className="border-dashed p-5 text-muted-foreground text-sm">
					No repositories yet.
				</Card>
			</section>
		)

	return (
		<section className="flex flex-col gap-3">
			<RepositoryListHeader username={username} />
			<Card className="gap-0 divide-y divide-border p-0">
				{repositories.map(repository => (
					<Link
						className="block p-4 transition-colors hover:bg-muted/60"
						key={repository.repository.id}
						params={{
							slug: repository.repository.slug,
							username: repository.owner.username,
						}}
						to="/$username/$slug"
					>
						<div className="flex min-w-0 items-start justify-between gap-4">
							<div className="flex min-w-0 flex-col gap-1">
								<h3 className="truncate font-medium text-base">
									{repository.repository.name}
								</h3>
								<p className="truncate text-muted-foreground text-sm">
									{repository.owner.username}/{repository.repository.slug}
								</p>
							</div>
							<span className="shrink-0 rounded-md border border-border px-2 py-1 text-muted-foreground text-xs capitalize">
								{repository.repository.visibility}
							</span>
						</div>
					</Link>
				))}
			</Card>
		</section>
	)
}

interface RepositoryListHeaderProps {
	username: string
}

function RepositoryListHeader({
	username,
}: Readonly<RepositoryListHeaderProps>) {
	return (
		<div>
			<h2 className="font-semibold text-xl tracking-normal">Repositories</h2>
			<p className="text-muted-foreground text-sm">
				Projects owned by @{username}.
			</p>
		</div>
	)
}

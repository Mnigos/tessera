import type { HandleRepository } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { Link } from '@tanstack/react-router'
import { FaGithub } from 'react-icons/fa'

interface ProfileRepositoriesSectionProps {
	handle: string
	repositories: HandleRepository[]
	isOwner: boolean
}

export function ProfileRepositoriesSection({
	handle,
	repositories,
	isOwner,
}: Readonly<ProfileRepositoriesSectionProps>) {
	if (repositories.length === 0)
		return (
			<section className="flex flex-col gap-3">
				<RepositoryListHeader handle={handle} />
				<Card className="gap-4 border-dashed p-5">
					<div className="flex flex-col gap-1">
						<p className="text-muted-foreground text-sm">
							No repositories yet.
						</p>
						{isOwner && (
							<p className="text-muted-foreground text-sm">
								Import your existing projects straight from GitHub to get
								started.
							</p>
						)}
					</div>
					{isOwner && (
						<Button
							className="self-start"
							nativeButton={false}
							render={<Link to="/import/github" />}
							size="sm"
						>
							<FaGithub className="size-4" />
							Import from GitHub
						</Button>
					)}
				</Card>
			</section>
		)

	return (
		<section className="flex flex-col gap-3">
			<RepositoryListHeader handle={handle} />
			<Card className="gap-0 divide-y divide-border p-0">
				{repositories.map(repository => (
					<Link
						className="block p-4 transition-colors hover:bg-muted/60"
						key={repository.id}
						params={{ slug: repository.slug, username: handle }}
						to="/$username/$slug"
					>
						<div className="flex min-w-0 items-start justify-between gap-4">
							<div className="flex min-w-0 flex-col gap-1">
								<h3 className="truncate font-medium text-base">
									{repository.name}
								</h3>
								<p className="truncate text-muted-foreground text-sm">
									{handle}/{repository.slug}
								</p>
							</div>
							<span className="shrink-0 rounded-md border border-border px-2 py-1 text-muted-foreground text-xs capitalize">
								{repository.visibility}
							</span>
						</div>
					</Link>
				))}
			</Card>
		</section>
	)
}

interface RepositoryListHeaderProps {
	handle: string
}

function RepositoryListHeader({ handle }: Readonly<RepositoryListHeaderProps>) {
	return (
		<div>
			<h2 className="font-semibold text-xl tracking-normal">Repositories</h2>
			<p className="text-muted-foreground text-sm">
				Projects owned by @{handle}.
			</p>
		</div>
	)
}

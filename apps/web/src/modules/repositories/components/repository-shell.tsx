import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'

interface RepositoryShellProps {
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryShell({
	owner,
	repository,
}: Readonly<RepositoryShellProps>) {
	return (
		<section className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<p className="text-muted-foreground text-sm">{owner.username}</p>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<h1 className="truncate font-semibold text-3xl tracking-normal">
							{repository.name}
						</h1>
						<p className="truncate text-muted-foreground">
							{owner.username}/{repository.slug}
						</p>
					</div>
					<span className="w-fit rounded-md border border-border px-2.5 py-1 text-muted-foreground text-sm capitalize">
						{repository.visibility}
					</span>
				</div>
			</div>
			<Card className="p-5">
				<dl className="grid gap-4 sm:grid-cols-2">
					<RepositoryDetail label="Owner" value={owner.username} />
					<RepositoryDetail label="Name" value={repository.name} />
					<RepositoryDetail label="Slug" value={repository.slug} />
					<RepositoryDetail label="Visibility" value={repository.visibility} />
					<div className="sm:col-span-2">
						<dt className="text-muted-foreground text-sm">Description</dt>
						<dd className="mt-1 text-sm">
							{repository.description || 'No description'}
						</dd>
					</div>
				</dl>
			</Card>
		</section>
	)
}

interface RepositoryDetailProps {
	label: string
	value: string
}

function RepositoryDetail({ label, value }: Readonly<RepositoryDetailProps>) {
	return (
		<div>
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="mt-1 text-sm">{value}</dd>
		</div>
	)
}

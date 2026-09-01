import type { RepositoryBrowserSummary } from '@repo/contracts'
import { Skeleton } from '@repo/ui/components/skeleton'
import { getSelectedRepositoryQualifiedRef } from '../helpers/repository-refs'
import { isRepositoryOwner } from '../helpers/repository-viewer-role'
import { RepositoryNavigation } from './repository-navigation'
import {
	RepositorySourceChip,
	RepositorySourceSyncLine,
} from './repository-source'

interface RepositoryHeaderProps {
	summary: RepositoryBrowserSummary
	selectedRef?: string
}

/** The shell every repository page sits under: identity first, then the tabs. */
export function RepositoryHeader({
	summary,
	selectedRef,
}: Readonly<RepositoryHeaderProps>) {
	const { owner, repository, defaultBranch } = summary
	const selectedQualifiedRef = getSelectedRepositoryQualifiedRef({
		defaultBranch,
		selectedRef,
		summary,
	})

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<p className="truncate text-muted-foreground text-sm">
					{owner.handle}/{repository.slug}
				</p>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
					<h1 className="min-w-0 truncate font-semibold text-3xl tracking-normal">
						{repository.name}
					</h1>
					<span className="rounded-md border border-border px-2.5 py-1 text-muted-foreground text-sm capitalize">
						{repository.visibility}
					</span>
					<RepositorySourceChip repository={repository} />
				</div>
			</div>
			<RepositorySourceSyncLine
				isOwner={isRepositoryOwner(summary.viewerRole)}
				owner={owner}
				repository={repository}
			/>
			{repository.description && (
				<p className="max-w-3xl text-muted-foreground text-sm">
					{repository.description}
				</p>
			)}
			<RepositoryNavigation
				selectedQualifiedRef={selectedQualifiedRef}
				selectedRef={selectedRef}
				summary={summary}
			/>
		</div>
	)
}

export function RepositoryHeaderSkeleton() {
	return (
		<div className="flex flex-col gap-3">
			<Skeleton className="h-5 max-w-56" />
			<Skeleton className="h-9 max-w-sm" />
			<Skeleton className="h-9 max-w-xl" />
		</div>
	)
}

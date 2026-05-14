import type { RepositoryBrowserSummary } from '@repo/contracts'
import { GitBranch } from 'lucide-react'
import { RepositoryEmptyState } from './repository-empty-state'
import { RepositoryReadmePreview } from './repository-readme-preview'
import { RepositoryRootTree } from './repository-root-tree'

interface RepositoryOverviewProps {
	summary: RepositoryBrowserSummary
}

export function RepositoryOverview({
	summary: { owner, repository, defaultBranch, rootEntries, isEmpty, readme },
}: Readonly<RepositoryOverviewProps>) {
	return (
		<section className="flex flex-col gap-6">
			<header className="flex flex-col gap-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<p className="truncate text-muted-foreground text-sm">
							{owner.username}/{repository.slug}
						</p>
						<h1 className="truncate font-semibold text-3xl tracking-normal">
							{repository.name}
						</h1>
					</div>
					<span className="w-fit rounded-md border border-border px-2.5 py-1 text-muted-foreground text-sm capitalize">
						{repository.visibility}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
					<span className="inline-flex items-center gap-1.5">
						<GitBranch className="size-4" />
						{defaultBranch}
					</span>
					<span>
						{rootEntries.length} root{' '}
						{rootEntries.length === 1 ? 'entry' : 'entries'}
					</span>
				</div>
				{repository.description && (
					<p className="max-w-3xl text-muted-foreground text-sm">
						{repository.description}
					</p>
				)}
			</header>
			{isEmpty ? (
				<RepositoryEmptyState owner={owner} repository={repository} />
			) : (
				<>
					{readme && <RepositoryReadmePreview readme={readme} />}
					<RepositoryRootTree entries={rootEntries} />
				</>
			)}
		</section>
	)
}

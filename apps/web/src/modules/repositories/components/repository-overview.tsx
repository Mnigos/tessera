import type { RepositoryBrowserSummary } from '@repo/contracts'
import { Link, useNavigate } from '@tanstack/react-router'
import { History } from 'lucide-react'
import {
	getRepositoryRefDisplayName,
	getRepositoryRefOptions,
	getSelectedRepositoryQualifiedRef,
} from '../helpers/repository-refs'
import { RepositoryEmptyState } from './repository-empty-state'
import { RepositoryReadmePreview } from './repository-readme-preview'
import { RepositoryRefSelector } from './repository-ref-selector'
import { RepositoryRootTree } from './repository-root-tree'

interface RepositoryOverviewProps {
	summary: RepositoryBrowserSummary
	selectedRef?: string
}

export function RepositoryOverview({
	summary: { owner, repository, defaultBranch, rootEntries, isEmpty, readme },
	summary,
	selectedRef,
}: Readonly<RepositoryOverviewProps>) {
	const navigate = useNavigate({ from: '/$username/$slug' })
	const refOptions = getRepositoryRefOptions(summary)
	const selectedQualifiedRef = getSelectedRepositoryQualifiedRef({
		defaultBranch,
		selectedRef,
		summary,
	})
	const selectedRefName = getRepositoryRefDisplayName(selectedQualifiedRef)

	function handleSelectedRefChange(ref: string) {
		navigate({ search: previousSearch => ({ ...previousSearch, ref }) })
	}

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
					<RepositoryRefSelector
						disabled={isEmpty}
						onSelectedRefChange={handleSelectedRefChange}
						refs={refOptions}
						selectedRef={selectedQualifiedRef}
					/>
					<span>
						{rootEntries.length} root{' '}
						{rootEntries.length === 1 ? 'entry' : 'entries'}
					</span>
					<Link
						aria-label={`View commits for ${selectedRefName}`}
						className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 font-medium text-foreground text-xs transition-colors hover:bg-secondary"
						params={{
							username: owner.username,
							slug: repository.slug,
							ref: selectedQualifiedRef,
						}}
						to="/$username/$slug/commits/$ref"
					>
						<History className="size-4" />
						Commits
					</Link>
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
					<RepositoryRootTree
						entries={rootEntries}
						refName={selectedQualifiedRef}
						slug={repository.slug}
						username={owner.username}
					/>
				</>
			)}
		</section>
	)
}

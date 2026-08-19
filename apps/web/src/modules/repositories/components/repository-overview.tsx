import type { RepositoryBrowserSummary } from '@repo/contracts'
import { useNavigate } from '@tanstack/react-router'
import {
	getRepositoryRefOptions,
	getSelectedRepositoryQualifiedRef,
} from '../helpers/repository-refs'
import { isRepositoryOwner } from '../helpers/repository-viewer-role'
import { RepositoryClonePopover } from './repository-clone-popover'
import { RepositoryEmptyState } from './repository-empty-state'
import { RepositoryNavigation } from './repository-navigation'
import { RepositoryReadmePreview } from './repository-readme-preview'
import { RepositoryRefSelector } from './repository-ref-selector'
import { RepositoryRootTree } from './repository-root-tree'
import {
	RepositorySourceChip,
	RepositorySourceSyncLine,
} from './repository-source'

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

	function handleSelectedRefChange(ref: string) {
		navigate({ search: previousSearch => ({ ...previousSearch, ref }) })
	}

	return (
		<section className="flex flex-col gap-6">
			<header className="flex flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="truncate text-muted-foreground text-sm">
						{owner.username}/{repository.slug}
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
			</header>
			<RepositoryNavigation
				selectedQualifiedRef={selectedQualifiedRef}
				selectedRef={selectedRef}
				summary={summary}
			/>
			<div className="flex flex-col gap-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
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
					</div>
					<RepositoryClonePopover repository={repository} />
				</div>
				{isEmpty ? (
					<RepositoryEmptyState repository={repository} />
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
			</div>
		</section>
	)
}

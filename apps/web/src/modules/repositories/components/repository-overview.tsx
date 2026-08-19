import type { RepositoryBrowserSummary } from '@repo/contracts'
import { useNavigate } from '@tanstack/react-router'
import {
	getRepositoryRefOptions,
	getSelectedRepositoryQualifiedRef,
} from '../helpers/repository-refs'
import { RepositoryClonePopover } from './repository-clone-popover'
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

	function handleSelectedRefChange(ref: string) {
		navigate({ search: previousSearch => ({ ...previousSearch, ref }) })
	}

	return (
		<section className="flex flex-col gap-4">
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
		</section>
	)
}

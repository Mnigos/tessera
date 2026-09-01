import type { Repository, RepositoryOwner } from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { getRepositorySyncHealthPresentation } from '../helpers/repository-sync-health'
import { useGitHubSyncHealthQuery } from '../hooks/use-github-sync-health.query'

const AUTHORITY_STATEMENTS = {
	github_to_tessera: {
		label: 'GitHub is the source of truth',
		className: 'border-border bg-secondary text-muted-foreground',
	},
	imported: {
		label: 'Imported from GitHub',
		className: 'border-border bg-secondary text-muted-foreground',
	},
	tessera_source: {
		label: 'Tessera is the source of truth',
		className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
	},
} satisfies Record<string, { label: string; className: string }>

interface RepositorySourceChipProps {
	repository: Repository
}

export function RepositorySourceChip({
	repository: { externalSource },
}: Readonly<RepositorySourceChipProps>) {
	if (externalSource.mode === 'none') return null

	const { className, label } = AUTHORITY_STATEMENTS[externalSource.mode]

	return (
		<span className="inline-flex min-w-0 items-center gap-2 text-xs">
			<span
				className={cn(
					'shrink-0 rounded-md border px-2 py-0.5 font-medium',
					className
				)}
			>
				{label}
			</span>
			<span aria-hidden className="text-muted-foreground">
				·
			</span>
			<a
				className="inline-flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
				href={externalSource.sourceUrl}
				rel="noreferrer"
				target="_blank"
			>
				<span className="truncate">{externalSource.fullName}</span>
				<ArrowUpRight aria-hidden className="size-3 shrink-0" />
			</a>
		</span>
	)
}

interface RepositorySourceSyncLineProps {
	isOwner: boolean
	owner: RepositoryOwner
	repository: Repository
}

export function RepositorySourceSyncLine({
	isOwner,
	owner,
	repository,
}: Readonly<RepositorySourceSyncLineProps>) {
	const isMirrored = repository.externalSource.mode === 'github_to_tessera'
	const syncHealthQuery = useGitHubSyncHealthQuery(
		{ slug: repository.slug, username: owner.handle },
		isOwner && isMirrored
	)
	const syncHealth = syncHealthQuery.data?.syncHealth

	if (!(isOwner && isMirrored && syncHealth)) return null

	const presentation = getRepositorySyncHealthPresentation(syncHealth)

	return (
		<p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
			<span
				className={cn(
					'inline-flex items-center gap-1.5',
					presentation.iconClassName
				)}
			>
				<presentation.icon aria-hidden className="size-3.5 shrink-0" />
				{presentation.label}
			</span>
			{!presentation.isQuiet && <span>{presentation.description}</span>}
			{!presentation.isQuiet && isOwner && (
				<Link
					className="underline hover:text-foreground"
					params={{ username: owner.handle, slug: repository.slug }}
					to="/$username/$slug/settings/github"
				>
					Sync details
				</Link>
			)}
		</p>
	)
}

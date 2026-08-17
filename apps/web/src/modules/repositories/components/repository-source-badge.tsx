import type {
	Repository,
	RepositoryOwner,
	RepositorySyncHealth,
} from '@repo/contracts'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { getRepositorySyncHealthPresentation } from '../helpers/repository-sync-health'
import { useGitHubSyncHealthQuery } from '../hooks/use-github-sync-health.query'

interface RepositorySourceBadgeProps {
	isOwner: boolean
	owner: RepositoryOwner
	repository: Repository
}

/**
 * One line saying where this repository comes from and who owns it now.
 *
 * It carries no controls at all. Enabling a mirror and changing authority are
 * settings, not things to trip over while reading code, and the overview says
 * only enough about synchronization for a reader to know whether to trust what
 * is below it.
 */
export function RepositorySourceBadge({
	isOwner,
	owner,
	repository,
}: Readonly<RepositorySourceBadgeProps>) {
	const externalSource = repository.externalSource
	// A repository nobody imported has no provenance to state, and a placeholder
	// saying so would be noise on every native repository in Tessera.
	const isMirrored = externalSource.mode === 'github_to_tessera'
	const syncHealthQuery = useGitHubSyncHealthQuery(
		{ slug: repository.slug, username: owner.handle },
		isOwner && isMirrored
	)

	if (externalSource.mode === 'none') return null

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-card/50 px-3 py-2 text-sm">
			<RepositoryAuthorityStatement mode={externalSource.mode} />
			<a
				className="inline-flex min-w-0 items-center gap-1 text-muted-foreground hover:text-foreground hover:underline"
				href={externalSource.sourceUrl}
				rel="noreferrer"
				target="_blank"
			>
				<span className="truncate">{externalSource.fullName}</span>
				<ArrowUpRight aria-hidden className="size-3 shrink-0" />
			</a>
			{isMirrored && syncHealthQuery.data?.syncHealth && (
				<RepositorySourceSyncState
					isOwner={isOwner}
					owner={owner}
					repository={repository}
					syncHealth={syncHealthQuery.data.syncHealth}
				/>
			)}
		</div>
	)
}

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

interface RepositoryAuthorityStatementProps {
	mode: keyof typeof AUTHORITY_STATEMENTS
}

function RepositoryAuthorityStatement({
	mode,
}: Readonly<RepositoryAuthorityStatementProps>) {
	const { className, label } = AUTHORITY_STATEMENTS[mode]

	return (
		<span
			className={cn(
				'inline-flex shrink-0 rounded-md border px-2 py-0.5 font-medium text-xs',
				className
			)}
		>
			{label}
		</span>
	)
}

interface RepositorySourceSyncStateProps extends RepositorySourceBadgeProps {
	syncHealth: RepositorySyncHealth
}

/**
 * How synchronization is doing, in as few words as the state allows. A healthy
 * mirror says so once and stops; anything else says what is uncertain and, for
 * the people who can act on it, where the detail lives.
 */
function RepositorySourceSyncState({
	isOwner,
	owner,
	repository,
	syncHealth,
}: Readonly<RepositorySourceSyncStateProps>) {
	const presentation = getRepositorySyncHealthPresentation(syncHealth)

	return (
		<span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
			<span
				className={cn(
					'inline-flex items-center gap-1.5',
					presentation.iconClassName
				)}
			>
				<presentation.icon aria-hidden className="size-3.5 shrink-0" />
				{presentation.label}
			</span>
			{!presentation.isQuiet && (
				<span className="text-muted-foreground">
					{presentation.description}
				</span>
			)}
			{!presentation.isQuiet && isOwner && (
				<Link
					className="text-muted-foreground underline hover:text-foreground"
					params={{ username: owner.handle, slug: repository.slug }}
					to="/$username/$slug/settings/github"
				>
					Sync details
				</Link>
			)}
		</span>
	)
}

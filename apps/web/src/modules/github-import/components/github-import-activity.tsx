import type { GitHubRepositoryImport } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { cn } from '@repo/ui/utils'
import { Link } from '@tanstack/react-router'
import { GitHubImportActivityRow } from './github-import-activity-row'

const RECENT_IMPORTS_LIMIT = 5
const TERMINAL_STATUSES: GitHubRepositoryImport['status'][] = [
	'succeeded',
	'failed',
]

interface GitHubImportActivityProps {
	conflictSourceGithubIds?: string[]
	imports: GitHubRepositoryImport[]
	isError: boolean
	isLoading: boolean
	queuedImportIds?: string[]
	username?: string
}

export function GitHubImportActivity({
	conflictSourceGithubIds = [],
	imports,
	isError,
	isLoading,
	queuedImportIds = [],
	username,
}: Readonly<GitHubImportActivityProps>) {
	const queuedImportIdSet = new Set<string>(queuedImportIds)
	const conflictSourceGithubIdSet = new Set(conflictSourceGithubIds)
	const isImportSession = queuedImportIdSet.size > 0
	const queuedImports = imports.filter(repositoryImport =>
		queuedImportIdSet.has(repositoryImport.id)
	)
	const orderedImports = isImportSession
		? [
				...queuedImports,
				...imports.filter(
					repositoryImport => !queuedImportIdSet.has(repositoryImport.id)
				),
			]
		: imports
	const visibleImports = orderedImports.slice(
		0,
		Math.max(RECENT_IMPORTS_LIMIT, queuedImports.length)
	)
	const hasFinished =
		isImportSession &&
		queuedImports.length === queuedImportIdSet.size &&
		queuedImports.every(repositoryImport =>
			TERMINAL_STATUSES.includes(repositoryImport.status)
		)
	const hasFailedImports = queuedImports.some(
		repositoryImport => repositoryImport.status === 'failed'
	)

	if (isLoading)
		return (
			<Card className="gap-3 p-5">
				<div className="h-5 w-32 animate-pulse rounded-md bg-secondary" />
				<div className="h-16 animate-pulse rounded-md bg-secondary/60" />
			</Card>
		)

	if (isError)
		return (
			<Card className="border-dashed p-5">
				<h2 className="font-semibold text-base tracking-normal">
					Import activity unavailable
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					Recent GitHub imports could not be loaded.
				</p>
			</Card>
		)

	if (visibleImports.length === 0 && !isImportSession) return null

	return (
		<Card
			className={cn(
				'gap-4 p-5',
				isImportSession && 'shadow-lg ring-1 ring-primary/30'
			)}
			data-github-import-activity=""
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					{isImportSession ? 'Import progress' : 'Recent imports'}
				</h2>
				<p className="text-muted-foreground text-sm">
					Import status updates automatically while work is running.
				</p>
			</div>
			{hasFinished && (
				<div className="flex flex-col items-start gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
					<p className="font-medium text-sm">
						{hasFailedImports
							? 'All imports finished — some need a retry.'
							: 'All imports finished'}
					</p>
					{username && (
						<Link
							className="text-primary text-sm underline-offset-4 hover:underline"
							params={{ username }}
							to="/profile/$username"
						>
							View all your repositories
						</Link>
					)}
				</div>
			)}
			{visibleImports.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Preparing the queued imports...
				</p>
			) : (
				<div className="flex flex-col divide-y divide-border">
					{visibleImports.map(repositoryImport => (
						<GitHubImportActivityRow
							import={repositoryImport}
							isHighlighted={conflictSourceGithubIdSet.has(
								repositoryImport.source.githubId
							)}
							key={repositoryImport.id}
							username={username}
						/>
					))}
				</div>
			)}
		</Card>
	)
}

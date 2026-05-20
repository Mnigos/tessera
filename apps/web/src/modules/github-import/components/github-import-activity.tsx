import type { GitHubRepositoryImport } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { Link } from '@tanstack/react-router'

interface GitHubImportActivityProps {
	imports: GitHubRepositoryImport[]
	isError: boolean
	isLoading: boolean
	username?: string
}

export function GitHubImportActivity({
	imports,
	isError,
	isLoading,
	username,
}: Readonly<GitHubImportActivityProps>) {
	const recentImports = imports.slice(0, 5)

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

	if (recentImports.length === 0) return null

	return (
		<Card className="gap-4 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					Recent imports
				</h2>
				<p className="text-muted-foreground text-sm">
					Import status updates automatically while work is running.
				</p>
			</div>
			<div className="flex flex-col divide-y divide-border">
				{recentImports.map(repositoryImport => (
					<GitHubImportActivityRow
						import={repositoryImport}
						key={repositoryImport.id}
						username={username}
					/>
				))}
			</div>
		</Card>
	)
}

interface GitHubImportActivityRowProps {
	import: GitHubRepositoryImport
	username?: string
}

function GitHubImportActivityRow({
	import: repositoryImport,
	username,
}: Readonly<GitHubImportActivityRowProps>) {
	const canOpenRepository =
		repositoryImport.status === 'succeeded' &&
		Boolean(username) &&
		Boolean(repositoryImport.repositoryId)

	return (
		<div className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-col gap-1">
				<div className="flex items-center gap-2">
					<p className="truncate font-medium text-sm">
						{repositoryImport.source.fullName}
					</p>
					<GitHubImportStatusBadge status={repositoryImport.status} />
				</div>
				<p className="text-muted-foreground text-xs">
					Target: {repositoryImport.targetSlug}
				</p>
				{repositoryImport.failureReason && (
					<p className="text-destructive text-xs">
						{repositoryImport.failureReason}
					</p>
				)}
			</div>
			{canOpenRepository && username && (
				<Link
					className="inline-flex h-8 items-center justify-center rounded-md bg-secondary px-3 font-medium text-secondary-foreground text-xs transition duration-150 ease-out hover:bg-secondary/80"
					params={{
						slug: repositoryImport.targetSlug,
						username,
					}}
					to="/$username/$slug"
				>
					Open
				</Link>
			)}
		</div>
	)
}

interface GitHubImportStatusBadgeProps {
	status: GitHubRepositoryImport['status']
}

function GitHubImportStatusBadge({
	status,
}: Readonly<GitHubImportStatusBadgeProps>) {
	const className =
		status === 'failed'
			? 'border-destructive/40 bg-destructive/10 text-destructive'
			: 'border-border bg-secondary text-secondary-foreground'

	return (
		<span
			className={`inline-flex rounded-md border px-2 py-0.5 font-medium text-xs ${className}`}
		>
			{status}
		</span>
	)
}

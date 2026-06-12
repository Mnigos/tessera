import type { GitHubRepositoryImport } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { GitHubImportActivityRow } from './github-import-activity-row'

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

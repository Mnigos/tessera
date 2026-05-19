import type { GitHubImportRepository } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { formatGitHubImportDate } from '../helpers/format-github-import-date'

interface GitHubImportSelectedSourceProps {
	repository?: GitHubImportRepository
}

export function GitHubImportSelectedSource({
	repository,
}: Readonly<GitHubImportSelectedSourceProps>) {
	return (
		<Card className="gap-4 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Selected source
				</h2>
				<p className="text-muted-foreground text-sm">
					{repository
						? repository.fullName
						: 'Choose a GitHub repository to continue.'}
				</p>
			</div>
			{repository && (
				<div className="flex flex-col gap-2 text-sm">
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">Visibility</span>
						<span className="capitalize">{repository.visibility}</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">Default branch</span>
						<span>{repository.defaultBranch}</span>
					</div>
					{repository.pushedAt && (
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">Last pushed</span>
							<span>{formatGitHubImportDate(repository.pushedAt)}</span>
						</div>
					)}
				</div>
			)}
			<Button className="w-full" disabled>
				Continue
			</Button>
		</Card>
	)
}

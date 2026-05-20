import type { GitHubImportRepository } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Card } from '@repo/ui/components/card'
import { formatGitHubImportDate } from '../helpers/format-github-import-date'

interface GitHubImportSelectedSourceProps {
	error?: unknown
	isImporting: boolean
	onContinue: () => void
	repositories: GitHubImportRepository[]
}

export function GitHubImportSelectedSource({
	error,
	isImporting,
	onContinue,
	repositories,
}: Readonly<GitHubImportSelectedSourceProps>) {
	const repositoryCount = repositories.length
	const firstRepository = repositories[0]

	return (
		<Card className="gap-4 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Selected sources
				</h2>
				<p className="text-muted-foreground text-sm">
					{repositoryCount > 0
						? `${repositoryCount} ${repositoryCount === 1 ? 'repository' : 'repositories'} ready to import.`
						: 'Choose GitHub repositories to continue.'}
				</p>
			</div>
			{firstRepository && (
				<div className="flex flex-col gap-2 text-sm">
					<div className="flex max-h-40 flex-col gap-2 overflow-y-auto pr-1">
						{repositories.map(repository => (
							<div
								className="rounded-md bg-muted/50 px-3 py-2 font-medium text-sm"
								key={repository.githubId}
							>
								{repository.fullName}
							</div>
						))}
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">First visibility</span>
						<span className="capitalize">{firstRepository.visibility}</span>
					</div>
					<div className="flex items-center justify-between gap-3">
						<span className="text-muted-foreground">First branch</span>
						<span>{firstRepository.defaultBranch}</span>
					</div>
					{firstRepository.pushedAt && (
						<div className="flex items-center justify-between gap-3">
							<span className="text-muted-foreground">First pushed</span>
							<span>{formatGitHubImportDate(firstRepository.pushedAt)}</span>
						</div>
					)}
				</div>
			)}
			{Boolean(error) && (
				<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm">
					{getGitHubImportErrorMessage(error)}
				</div>
			)}
			<Button
				className="w-full cursor-pointer transition duration-150 ease-out hover:-translate-y-px hover:bg-primary/90"
				disabled={repositoryCount === 0 || isImporting}
				onClick={onContinue}
			>
				{isImporting ? 'Importing...' : 'Continue'}
			</Button>
		</Card>
	)
}

function getGitHubImportErrorMessage(error: unknown): string {
	if (error && typeof error === 'object' && 'message' in error) {
		const message = String(error.message)

		if (message === 'github repository import source already exists')
			return 'This GitHub repository already has an active import.'
		if (message === 'github repository import target slug already exists')
			return 'A repository with this target slug already exists.'

		return 'GitHub import could not be queued.'
	}

	return 'GitHub import could not be queued.'
}

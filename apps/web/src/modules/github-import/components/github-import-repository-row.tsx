import type { GitHubImportRepository } from '@repo/contracts'
import { CalendarClock, GitBranch, Lock, Radio, Unlock } from 'lucide-react'
import { formatGitHubImportDate } from '../helpers/format-github-import-date'

interface GitHubImportRepositoryRowProps {
	isSelected: boolean
	onToggleRepository: (repositoryId: string) => void
	repository: GitHubImportRepository
}

export function GitHubImportRepositoryRow({
	isSelected,
	onToggleRepository,
	repository,
}: Readonly<GitHubImportRepositoryRowProps>) {
	return (
		<button
			aria-pressed={isSelected}
			className="group grid w-full cursor-pointer gap-3 p-4 text-left transition duration-150 ease-out hover:-translate-y-px hover:bg-muted/60 aria-pressed:bg-primary/10 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
			onClick={() => onToggleRepository(repository.githubId)}
			type="button"
		>
			<div className="flex min-w-0 flex-col gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<Radio
						className={
							isSelected
								? 'size-4 shrink-0 fill-primary text-primary'
								: 'size-4 shrink-0 text-muted-foreground'
						}
					/>
					<h2 className="truncate font-medium text-base">
						{repository.fullName}
					</h2>
				</div>
				<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
					<span className="inline-flex items-center gap-1.5 capitalize">
						{repository.visibility === 'private' ? (
							<Lock className="size-4" />
						) : (
							<Unlock className="size-4" />
						)}
						{repository.visibility}
					</span>
					<span className="inline-flex min-w-0 items-center gap-1.5">
						<GitBranch className="size-4 shrink-0" />
						<span className="truncate">{repository.defaultBranch}</span>
					</span>
					{repository.pushedAt && (
						<span className="inline-flex items-center gap-1.5">
							<CalendarClock className="size-4" />
							Pushed {formatGitHubImportDate(repository.pushedAt)}
						</span>
					)}
				</div>
			</div>
			<span className="rounded-md border border-border px-2 py-1 text-muted-foreground text-xs transition duration-150 ease-out group-hover:border-primary/50 group-hover:bg-primary/10 group-hover:text-foreground">
				{isSelected ? 'Selected' : 'Choose'}
			</span>
		</button>
	)
}

import { Card } from '@repo/ui/components/card'
import { useRepositoryCommitsQuery } from '../hooks/use-repository-commits.query'
import { RepositoryBrowserMessage } from './repository-browser-message'
import { RepositoryCommitHistoryShell } from './repository-commit-history-shell'
import { RepositoryCommitRows } from './repository-commit-rows'

interface RepositoryCommitHistoryProps {
	username: string
	slug: string
	refName: string
}

export function RepositoryCommitHistory({
	username,
	slug,
	refName,
}: Readonly<RepositoryCommitHistoryProps>) {
	const { data, isError, isLoading } = useRepositoryCommitsQuery({
		username,
		slug,
		ref: refName,
	})

	if (isLoading)
		return (
			<RepositoryCommitHistoryShell
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryCommitHistoryLoadingState />
			</RepositoryCommitHistoryShell>
		)

	if (isError)
		return (
			<RepositoryCommitHistoryShell
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="Commits not found">
					The commit history for this ref could not be loaded.
				</RepositoryBrowserMessage>
			</RepositoryCommitHistoryShell>
		)

	if (!data)
		return (
			<RepositoryCommitHistoryShell
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="Commits not found">
					No commit history was returned for this ref.
				</RepositoryBrowserMessage>
			</RepositoryCommitHistoryShell>
		)

	return (
		<RepositoryCommitHistoryShell
			refName={data.ref}
			slug={data.repository.slug}
			username={data.owner.username}
		>
			<RepositoryCommitRows commits={data.commits} />
		</RepositoryCommitHistoryShell>
	)
}

function RepositoryCommitHistoryLoadingState() {
	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{repositoryCommitLoadingRows.map(row => (
				<div className="flex flex-col gap-3 px-4 py-4 sm:flex-row" key={row}>
					<div className="h-4 w-20 animate-pulse rounded bg-muted" />
					<div className="flex flex-1 flex-col gap-2">
						<div className="h-4 max-w-lg animate-pulse rounded bg-muted" />
						<div className="h-3 max-w-sm animate-pulse rounded bg-muted/70" />
					</div>
				</div>
			))}
		</Card>
	)
}

const repositoryCommitLoadingRows = ['commit-1', 'commit-2', 'commit-3']

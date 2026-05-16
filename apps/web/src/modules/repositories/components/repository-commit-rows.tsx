import { Card } from '@repo/ui/components/card'
import {
	formatRepositoryCommitDate,
	formatRepositoryCommitDateTime,
	formatRepositoryCommitIdentity,
	hasDifferentRepositoryCommitter,
} from '../helpers/repository-commit-formatting'
import type { RepositoryCommit } from '../hooks/use-repository-commits.query'
import { RepositoryBrowserMessage } from './repository-browser-message'

interface RepositoryCommitRowsProps {
	commits: RepositoryCommit[]
}

export function RepositoryCommitRows({
	commits,
}: Readonly<RepositoryCommitRowsProps>) {
	if (commits.length === 0)
		return (
			<RepositoryBrowserMessage title="No commits">
				This ref does not have any commits yet.
			</RepositoryBrowserMessage>
		)

	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{commits.map(commit => (
				<RepositoryCommitRow commit={commit} key={commit.sha} />
			))}
		</Card>
	)
}

interface RepositoryCommitRowProps {
	commit: RepositoryCommit
}

function RepositoryCommitRow({ commit }: Readonly<RepositoryCommitRowProps>) {
	const showCommitter = hasDifferentRepositoryCommitter(commit)

	return (
		<article
			className="grid gap-3 px-4 py-4 sm:grid-cols-[6rem_1fr]"
			data-commit-sha={commit.sha}
			data-testid="repository-commit-row"
		>
			<div className="font-mono text-muted-foreground text-sm">
				{commit.shortSha}
			</div>
			<div className="flex min-w-0 flex-col gap-2">
				<h2 className="truncate font-medium text-sm">{commit.summary}</h2>
				<div className="flex flex-col gap-1 text-muted-foreground text-sm">
					<RepositoryCommitIdentityLine
						identity={commit.author}
						label="Authored"
					/>
					{showCommitter && (
						<RepositoryCommitIdentityLine
							identity={commit.committer}
							label="Committed"
						/>
					)}
				</div>
			</div>
		</article>
	)
}

interface RepositoryCommitIdentityLineProps {
	label: string
	identity?: RepositoryCommit['author']
}

function RepositoryCommitIdentityLine({
	label,
	identity,
}: Readonly<RepositoryCommitIdentityLineProps>) {
	return (
		<p className="min-w-0">
			<span>{label}</span>{' '}
			<span className="text-foreground">
				{formatRepositoryCommitIdentity(identity)}
			</span>
			{identity?.date && (
				<>
					<span> on </span>
					<time dateTime={formatRepositoryCommitDateTime(identity.date)}>
						{formatRepositoryCommitDate(identity.date)}
					</time>
				</>
			)}
		</p>
	)
}

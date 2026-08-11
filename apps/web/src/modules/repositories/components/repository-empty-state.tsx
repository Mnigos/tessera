'use client'

import type { Repository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { CopyButton } from '@/shared/components/copy-button'
import { getCloneProtocolLabel } from '../helpers/get-clone-protocol-label'

interface RepositoryEmptyStateProps {
	repository: Repository
}

/**
 * An empty repository is only an invitation to push when Tessera is the one
 * that would accept the push. While GitHub owns the repository, the first
 * commit has to land there and arrive here through synchronization, so the
 * commands say so instead of offering a remote that would refuse them.
 *
 * Nothing here claims GitHub is empty either. Tessera holding no commits for a
 * mirror means only that none have synchronized: a repository with content
 * whose first run has not finished looks exactly like one that was never
 * pushed to, and this cannot tell them apart.
 */
export function RepositoryEmptyState({
	repository: { cloneUrls },
}: Readonly<RepositoryEmptyStateProps>) {
	const isGitHubAuthoritative = cloneUrls.authority === 'github'
	const cloneCommand = `git clone ${cloneUrls.ssh}`
	const existingProjectCommands = [
		`git remote add origin ${cloneUrls.ssh}`,
		'git branch -M main',
		'git push -u origin main',
	].join('\n')

	return (
		<Card className="gap-5 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					{isGitHubAuthoritative
						? 'Nothing synchronized yet'
						: 'Empty repository'}
				</h2>
				<p className="text-muted-foreground text-sm">
					{isGitHubAuthoritative
						? 'GitHub is the source of truth for this repository. Anything already on GitHub appears here once it synchronizes, and until the first push to GitHub there is nothing to show.'
						: 'Clone it locally or push an existing project to publish the first commit.'}
				</p>
			</div>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2 sm:flex-row">
					<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
						{cloneUrls.ssh}
					</code>
					<CopyButton
						copiedLabel="SSH clone URL copied"
						errorMessage="Could not copy clone URL"
						label="Copy SSH clone URL"
						text={cloneUrls.ssh}
					/>
				</div>
				<CommandBlock
					command={cloneCommand}
					copiedLabel="Clone command copied"
					errorMessage="Could not copy clone command"
					label="Copy clone command"
					title="Clone the repository"
				/>
				<CommandBlock
					command={existingProjectCommands}
					copiedLabel="Setup commands copied"
					errorMessage="Could not copy setup commands"
					label="Copy setup commands"
					title={
						isGitHubAuthoritative
							? 'Push an existing project to GitHub'
							: 'Push an existing project'
					}
				/>
				<p className="text-muted-foreground text-sm">
					{getCloneProtocolLabel(cloneUrls.https)} is also available:{' '}
					<code>{cloneUrls.https}</code>
				</p>
			</div>
		</Card>
	)
}

interface CommandBlockProps {
	command: string
	copiedLabel: string
	errorMessage: string
	label: string
	title: string
}

function CommandBlock({
	command,
	copiedLabel,
	errorMessage,
	label,
	title,
}: Readonly<CommandBlockProps>) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-medium text-sm">{title}</h3>
				<CopyButton
					copiedLabel={copiedLabel}
					errorMessage={errorMessage}
					label={label}
					text={command}
				/>
			</div>
			<pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-sm">
				<code>{command}</code>
			</pre>
		</div>
	)
}

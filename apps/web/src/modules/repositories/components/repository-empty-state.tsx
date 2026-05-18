'use client'

import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { CopyButton } from '@/shared/components/copy-button'
import {
	getRepositoryHttpCloneUrl,
	getRepositorySshCloneUrl,
} from '../helpers/get-repository-clone-url'

interface RepositoryEmptyStateProps {
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryEmptyState({
	owner,
	repository,
}: Readonly<RepositoryEmptyStateProps>) {
	const sshCloneUrl = getRepositorySshCloneUrl(repository, owner)
	const httpCloneUrl = getRepositoryHttpCloneUrl(repository, owner)
	const httpCloneProtocolLabel = getHttpCloneProtocolLabel(httpCloneUrl)
	const cloneCommand = `git clone ${sshCloneUrl}`
	const existingProjectCommands = [
		`git remote add origin ${sshCloneUrl}`,
		'git branch -M main',
		'git push -u origin main',
	].join('\n')

	return (
		<Card className="gap-5 p-5">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-lg tracking-normal">
					Empty repository
				</h2>
				<p className="text-muted-foreground text-sm">
					Clone it locally or push an existing project to publish the first
					commit.
				</p>
			</div>
			<div className="flex flex-col gap-4">
				<div className="flex flex-col gap-2 sm:flex-row">
					<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
						{sshCloneUrl}
					</code>
					<CopyButton
						copiedLabel="SSH clone URL copied"
						errorMessage="Could not copy clone URL"
						label="Copy SSH clone URL"
						text={sshCloneUrl}
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
					title="Push an existing project"
				/>
				<p className="text-muted-foreground text-sm">
					{httpCloneProtocolLabel} is also available:{' '}
					<code>{httpCloneUrl}</code>
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

function getHttpCloneProtocolLabel(httpCloneUrl: string) {
	try {
		const { protocol } = new URL(httpCloneUrl)

		if (protocol === 'https:') return 'HTTPS'
		if (protocol === 'http:') return 'HTTP'
	} catch {
		return 'HTTP/HTTPS'
	}

	return 'HTTP/HTTPS'
}

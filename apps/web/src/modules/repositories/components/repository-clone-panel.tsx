import type { Repository, RepositoryOwner } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import {
	getRepositoryHttpCloneUrl,
	getRepositorySshCloneUrl,
} from '../helpers/get-repository-clone-url'
import { RepositoryCopyButton } from './repository-copy-button'

interface RepositoryClonePanelProps {
	owner: RepositoryOwner
	repository: Repository
}

export function RepositoryClonePanel({
	owner,
	repository,
}: Readonly<RepositoryClonePanelProps>) {
	const sshCloneUrl = getRepositorySshCloneUrl(repository, owner)
	const httpCloneUrl = getRepositoryHttpCloneUrl(repository, owner)

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">Clone</h2>
				<p className="text-muted-foreground text-sm">
					Use SSH for authenticated Git access, or HTTPS when SSH is not
					available.
				</p>
			</div>
			<div className="grid gap-3">
				<CloneUrlRow
					copiedLabel="SSH clone URL copied"
					label="SSH"
					text={sshCloneUrl}
				/>
				<CloneUrlRow
					copiedLabel="HTTPS clone URL copied"
					label="HTTPS"
					text={httpCloneUrl}
				/>
			</div>
		</Card>
	)
}

interface CloneUrlRowProps {
	copiedLabel: string
	label: string
	text: string
}

function CloneUrlRow({ copiedLabel, label, text }: Readonly<CloneUrlRowProps>) {
	return (
		<div className="grid gap-2 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto] sm:items-center">
			<span className="font-medium text-muted-foreground text-xs uppercase">
				{label}
			</span>
			<code className="min-w-0 overflow-x-auto rounded-md border border-input bg-muted px-3 py-2 text-sm">
				{text}
			</code>
			<RepositoryCopyButton
				copiedLabel={copiedLabel}
				errorMessage="Could not copy clone URL"
				label={`Copy ${label} clone URL`}
				text={text}
			/>
		</div>
	)
}

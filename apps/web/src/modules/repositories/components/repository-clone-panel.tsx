import type { Repository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { CopyButton } from '@/shared/components/copy-button'
import { getCloneProtocolLabel } from '../helpers/get-clone-protocol-label'

interface RepositoryClonePanelProps {
	repository: Repository
}

/**
 * The remotes the API derived, which follow authority rather than the host the
 * page is served from: while GitHub owns the repository these point at GitHub,
 * and they switch to Tessera the moment it cuts over.
 */
export function RepositoryClonePanel({
	repository: { cloneUrls },
}: Readonly<RepositoryClonePanelProps>) {
	const isGitHubAuthoritative = cloneUrls.authority === 'github'
	// Never hardcoded: an Enterprise source reached over plain HTTP must not be
	// announced as HTTPS in the label, the copy confirmation, or the button name.
	const httpProtocolLabel = getCloneProtocolLabel(cloneUrls.https)

	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">Clone</h2>
				<p className="text-muted-foreground text-sm">
					{isGitHubAuthoritative
						? 'GitHub is the source of truth for this repository, so clones and pushes go to GitHub.'
						: `Use SSH for authenticated Git access, or ${httpProtocolLabel} when SSH is not available.`}
				</p>
			</div>
			<div className="grid gap-3">
				<CloneUrlRow
					copiedLabel="SSH clone URL copied"
					label="SSH"
					text={cloneUrls.ssh}
				/>
				<CloneUrlRow
					copiedLabel={`${httpProtocolLabel} clone URL copied`}
					label={httpProtocolLabel}
					text={cloneUrls.https}
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
			<CopyButton
				copiedLabel={copiedLabel}
				errorMessage="Could not copy clone URL"
				label={`Copy ${label} clone URL`}
				text={text}
			/>
		</div>
	)
}

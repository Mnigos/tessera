import type { Repository } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { ArrowUpRight } from 'lucide-react'
import { MirrorTimestamp, SourceField } from './repository-github-mirror-fields'

type RepositoryGitHubSource = Exclude<
	Repository['externalSource'],
	{ mode: 'none' }
>

interface RepositoryGitHubSourceDetailsProps {
	externalSource: RepositoryGitHubSource
}

const SOURCE_DESCRIPTIONS = {
	github_to_tessera:
		'GitHub is the source of truth. Pull requests, reviews, and checks are synchronized here, and Tessera refuses writes to them.',
	imported:
		'This repository was copied from GitHub once. Tessera owns it now, and nothing is being kept in step with GitHub.',
	tessera_source:
		'Tessera is the source of truth. This is where the repository came from, kept for provenance.',
} satisfies Record<RepositoryGitHubSource['mode'], string>

/**
 * Which GitHub repository this one came from, and what that relationship still
 * means. It survives cutover: where history came from stays true after Tessera
 * takes over.
 */
export function RepositoryGitHubSourceDetails({
	externalSource,
}: Readonly<RepositoryGitHubSourceDetailsProps>) {
	return (
		<Card className="gap-3 p-4">
			<div className="flex flex-col gap-1">
				<h2 className="font-semibold text-base tracking-normal">
					{externalSource.mode === 'tessera_source'
						? 'Historical source'
						: 'Source repository'}
				</h2>
				<p className="text-muted-foreground text-sm">
					{SOURCE_DESCRIPTIONS[externalSource.mode]}
				</p>
			</div>
			<a
				className="inline-flex w-fit min-w-0 items-center gap-1 font-medium text-sm hover:underline"
				href={externalSource.sourceUrl}
				rel="noreferrer"
				target="_blank"
			>
				<span className="truncate">{externalSource.fullName}</span>
				<ArrowUpRight aria-hidden className="size-3 shrink-0" />
			</a>
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
				<SourceField label="Owner" value={externalSource.ownerLogin} />
				<SourceField label="Repository" value={externalSource.name} />
				<SourceField
					label="Default branch"
					value={externalSource.sourceDefaultBranch}
				/>
				<MirrorTimestamp
					label="Last successful sync"
					value={externalSource.lastSyncSucceededAt}
				/>
				{/* Only rendered when a run is actually scheduled. A blocked mirror
				    has its schedule cleared until GitHub restores access, and a
				    cut-over one never runs again — in both cases "Never" would
				    contradict the sync-health card above, which is still saying
				    Tessera retries on its own. Absence of the row claims nothing. */}
				{externalSource.nextSyncAt && (
					<MirrorTimestamp
						label="Next scheduled sync"
						value={externalSource.nextSyncAt}
					/>
				)}
				{externalSource.cutoverAt && (
					<MirrorTimestamp
						label="Authority changed"
						value={externalSource.cutoverAt}
					/>
				)}
			</dl>
		</Card>
	)
}

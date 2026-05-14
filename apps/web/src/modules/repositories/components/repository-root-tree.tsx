import type { RepositoryTreeEntry } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { getBlobHref, getTreeHref } from './repository-browser-breadcrumbs'
import { RepositoryTreeEntryRow } from './repository-tree-entry-row'

interface RepositoryRootTreeProps {
	entries: RepositoryTreeEntry[]
	refName: string
	slug: string
	username: string
}

export function RepositoryRootTree({
	entries,
	refName,
	slug,
	username,
}: Readonly<RepositoryRootTreeProps>) {
	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="font-semibold text-lg tracking-normal">Files</h2>
				<p className="text-muted-foreground text-sm">Root tree</p>
			</div>
			{entries.length > 0 ? (
				<Card className="gap-0 divide-y divide-border p-0">
					{entries.map(entry => (
						<RepositoryTreeEntryRow
							entry={entry}
							href={getTreeEntryHref({ entry, refName, slug, username })}
							key={`${entry.path}:${entry.objectId}`}
							testId="file-tree-row"
						/>
					))}
				</Card>
			) : (
				<Card className="border-dashed p-4 text-muted-foreground text-sm">
					No root files or directories were returned.
				</Card>
			)}
		</section>
	)
}

interface GetTreeEntryHrefInput {
	entry: RepositoryTreeEntry
	refName: string
	slug: string
	username: string
}

function getTreeEntryHref({
	entry,
	refName,
	slug,
	username,
}: GetTreeEntryHrefInput) {
	if (entry.kind === 'directory')
		return getTreeHref(username, slug, refName, entry.path)

	if (entry.kind === 'file')
		return getBlobHref(username, slug, refName, entry.path)

	return undefined
}

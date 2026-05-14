import type { RepositoryTreeEntry } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import {
	File,
	FileQuestion,
	Folder,
	LinkIcon,
	type LucideIcon,
	Package,
} from 'lucide-react'
import { formatTreeEntrySize } from '../helpers/format-tree-entry-size'
import { getBlobHref, getTreeHref } from './repository-browser-breadcrumbs'

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
						<TreeEntryRow
							entry={entry}
							key={`${entry.path}:${entry.objectId}`}
							refName={refName}
							slug={slug}
							username={username}
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

interface TreeEntryRowProps {
	entry: RepositoryTreeEntry
	refName: string
	slug: string
	username: string
}

function TreeEntryRow({
	entry,
	refName,
	slug,
	username,
}: Readonly<TreeEntryRowProps>) {
	const Icon = treeEntryIcons[entry.kind]
	const href = getTreeEntryHref({ entry, refName, slug, username })
	const rowContent = (
		<>
			<div className="flex min-w-0 items-center gap-3">
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate font-medium">{entry.name}</span>
			</div>
			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span className="hidden capitalize sm:inline">{entry.kind}</span>
				<span>{formatTreeEntrySize(entry)}</span>
			</div>
		</>
	)

	if (!href)
		return (
			<div
				className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-sm"
				data-entry-name={entry.name}
				data-testid="file-tree-row"
			>
				{rowContent}
			</div>
		)

	return (
		<a
			className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-sm hover:bg-muted/40"
			data-entry-name={entry.name}
			data-testid="file-tree-row"
			href={href}
		>
			{rowContent}
		</a>
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

const treeEntryIcons = {
	directory: Folder,
	file: File,
	submodule: Package,
	symlink: LinkIcon,
	unknown: FileQuestion,
} satisfies Record<RepositoryTreeEntry['kind'], LucideIcon>

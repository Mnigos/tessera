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

interface RepositoryRootTreeProps {
	entries: RepositoryTreeEntry[]
}

export function RepositoryRootTree({
	entries,
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
}

function TreeEntryRow({ entry }: Readonly<TreeEntryRowProps>) {
	const Icon = treeEntryIcons[entry.kind]

	return (
		<div
			className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-sm"
			data-entry-name={entry.name}
			data-testid="file-tree-row"
		>
			<div className="flex min-w-0 items-center gap-3">
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<span className="truncate font-medium">{entry.name}</span>
			</div>
			<div className="flex items-center gap-3 text-muted-foreground text-xs">
				<span className="hidden capitalize sm:inline">{entry.kind}</span>
				<span>{formatTreeEntrySize(entry)}</span>
			</div>
		</div>
	)
}

const treeEntryIcons = {
	directory: Folder,
	file: File,
	submodule: Package,
	symlink: LinkIcon,
	unknown: FileQuestion,
} satisfies Record<RepositoryTreeEntry['kind'], LucideIcon>

function formatTreeEntrySize(entry: RepositoryTreeEntry) {
	if (entry.kind === 'directory') return entry.mode
	if (entry.sizeBytes == null) return '-'
	if (entry.sizeBytes < 1024) return `${entry.sizeBytes} B`

	const kibibytes = entry.sizeBytes / 1024
	if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KB`

	return `${(kibibytes / 1024).toFixed(1)} MB`
}

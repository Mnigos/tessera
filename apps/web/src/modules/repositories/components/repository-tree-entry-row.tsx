import type { RepositoryTreeEntry } from '@repo/contracts'
import { Link } from '@tanstack/react-router'
import {
	File,
	FileQuestion,
	Folder,
	LinkIcon,
	type LucideIcon,
	Package,
} from 'lucide-react'
import { formatTreeEntrySize } from '../helpers/format-tree-entry-size'

interface RepositoryTreeEntryRowProps {
	entry: RepositoryTreeEntry
	href: string | undefined
	testId: string
}

export function RepositoryTreeEntryRow({
	entry,
	href,
	testId,
}: Readonly<RepositoryTreeEntryRowProps>) {
	const Icon = treeEntryIcons[entry.kind]
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
				data-testid={testId}
			>
				{rowContent}
			</div>
		)

	return (
		<Link
			className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-sm hover:bg-muted/40"
			data-entry-name={entry.name}
			data-testid={testId}
			to={href}
		>
			{rowContent}
		</Link>
	)
}

const treeEntryIcons = {
	directory: Folder,
	file: File,
	submodule: Package,
	symlink: LinkIcon,
	unknown: FileQuestion,
} satisfies Record<RepositoryTreeEntry['kind'], LucideIcon>

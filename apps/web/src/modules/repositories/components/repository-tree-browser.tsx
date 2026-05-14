import { Card } from '@repo/ui/components/card'
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
import type { RepositoryTreeResult } from '../hooks/use-repository-tree.query'
import { useRepositoryTreeQuery } from '../hooks/use-repository-tree.query'
import {
	getBlobHref,
	getTreeHref,
	RepositoryBrowserBreadcrumbs,
} from './repository-browser-breadcrumbs'
import { RepositoryBrowserMessage } from './repository-browser-message'

interface RepositoryTreeBrowserProps {
	username: string
	slug: string
	refName: string
	path: string
}

export function RepositoryTreeBrowser({
	username,
	slug,
	refName,
	path,
}: Readonly<RepositoryTreeBrowserProps>) {
	const treeQuery = useRepositoryTreeQuery({
		username,
		slug,
		ref: refName,
		path,
	})

	if (treeQuery.isLoading)
		return (
			<RepositoryBrowserShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryTreeLoadingState />
			</RepositoryBrowserShell>
		)

	if (treeQuery.isError)
		return (
			<RepositoryBrowserShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="Directory not found">
					The requested tree could not be loaded.
				</RepositoryBrowserMessage>
			</RepositoryBrowserShell>
		)

	if (!treeQuery.data)
		return (
			<RepositoryBrowserShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="Directory not found">
					No tree data was returned for this path.
				</RepositoryBrowserMessage>
			</RepositoryBrowserShell>
		)

	return (
		<RepositoryBrowserShell
			path={treeQuery.data.path}
			refName={treeQuery.data.ref}
			slug={treeQuery.data.repository.slug}
			username={treeQuery.data.owner.username}
		>
			<TreeEntries tree={treeQuery.data} />
		</RepositoryBrowserShell>
	)
}

interface RepositoryBrowserShellProps {
	children: React.ReactNode
	username: string
	slug: string
	refName: string
	path: string
}

function RepositoryBrowserShell({
	children,
	username,
	slug,
	refName,
	path,
}: Readonly<RepositoryBrowserShellProps>) {
	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-3">
				<RepositoryBrowserBreadcrumbs
					path={path}
					refName={refName}
					slug={slug}
					username={username}
				/>
				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
					<span className="rounded-md border border-border px-2 py-1 font-mono">
						{refName}
					</span>
					<span className="min-w-0 truncate">{path || 'Repository root'}</span>
				</div>
			</header>
			{children}
		</section>
	)
}

function RepositoryTreeLoadingState() {
	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{repositoryTreeLoadingRows.map(row => (
				<div className="flex items-center gap-3 px-4 py-3" key={row}>
					<div className="size-4 animate-pulse rounded bg-muted" />
					<div className="h-4 flex-1 animate-pulse rounded bg-muted" />
					<div className="h-4 w-14 animate-pulse rounded bg-muted" />
				</div>
			))}
		</Card>
	)
}

const repositoryTreeLoadingRows = [
	'row-1',
	'row-2',
	'row-3',
	'row-4',
	'row-5',
	'row-6',
]

interface TreeEntriesProps {
	tree: RepositoryTreeResult
}

function TreeEntries({ tree }: Readonly<TreeEntriesProps>) {
	if (tree.entries.length === 0)
		return (
			<RepositoryBrowserMessage title="Empty directory">
				This directory has no files.
			</RepositoryBrowserMessage>
		)

	return (
		<Card className="gap-0 divide-y divide-border p-0">
			{tree.entries.map(entry => {
				const Icon = treeEntryIcons[entry.kind]
				const href = getTreeEntryHref({ entry, tree })
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
							data-testid="nested-file-tree-row"
							key={`${entry.path}:${entry.objectId}`}
						>
							{rowContent}
						</div>
					)

				return (
					<Link
						className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-sm hover:bg-muted/40"
						data-entry-name={entry.name}
						data-testid="nested-file-tree-row"
						key={`${entry.path}:${entry.objectId}`}
						to={href}
					>
						{rowContent}
					</Link>
				)
			})}
		</Card>
	)
}

interface GetTreeEntryHrefInput {
	entry: RepositoryTreeResult['entries'][number]
	tree: RepositoryTreeResult
}

function getTreeEntryHref({ entry, tree }: GetTreeEntryHrefInput) {
	if (entry.kind === 'directory')
		return getTreeHref(
			tree.owner.username,
			tree.repository.slug,
			tree.ref,
			entry.path
		)

	if (entry.kind === 'file')
		return getBlobHref(
			tree.owner.username,
			tree.repository.slug,
			tree.ref,
			entry.path
		)

	return undefined
}

const treeEntryIcons = {
	directory: Folder,
	file: File,
	submodule: Package,
	symlink: LinkIcon,
	unknown: FileQuestion,
} satisfies Record<RepositoryTreeResult['entries'][number]['kind'], LucideIcon>

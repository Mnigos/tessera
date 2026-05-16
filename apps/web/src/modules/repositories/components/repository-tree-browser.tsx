import type { RepositoryTree } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { useNavigate } from '@tanstack/react-router'
import {
	getFallbackRefOptions,
	getRepositoryRefDisplayName,
	getRepositoryRefOptionsFromRefs,
	getSelectedRepositoryRefOption,
} from '../helpers/repository-refs'
import { useRepositoryRefsQuery } from '../hooks/use-repository-refs.query'
import { useRepositoryTreeQuery } from '../hooks/use-repository-tree.query'
import {
	getBlobHref,
	getTreeHref,
	RepositoryBrowserBreadcrumbs,
} from './repository-browser-breadcrumbs'
import { RepositoryBrowserMessage } from './repository-browser-message'
import { RepositoryRefSelector } from './repository-ref-selector'
import { RepositoryTreeEntryRow } from './repository-tree-entry-row'

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
	const navigate = useNavigate()
	const refsQuery = useRepositoryRefsQuery({ slug, username })
	const refOptions = refsQuery.data
		? getRepositoryRefOptionsFromRefs(refsQuery.data)
		: getFallbackRefOptions(refName)
	const selectedRef = getSelectedRepositoryRefOption({
		refName,
		refs: refOptions,
	})
	const selectedRefName = getRepositoryRefDisplayName(refName)

	function handleSelectedRefChange(nextRefName: string) {
		navigate({ to: getTreeHref(username, slug, nextRefName, path) })
	}

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
					<RepositoryRefSelector
						disabled={refsQuery.isLoading || refsQuery.isError}
						onSelectedRefChange={handleSelectedRefChange}
						refs={refOptions}
						selectedRef={selectedRef}
					/>
					<span className="min-w-0 truncate">{path || 'Repository root'}</span>
					<span className="sr-only">Selected ref {selectedRefName}</span>
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
	tree: RepositoryTree
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
			{tree.entries.map(entry => (
				<RepositoryTreeEntryRow
					entry={entry}
					href={getTreeEntryHref({ entry, tree })}
					key={`${entry.path}:${entry.objectId}`}
					testId="nested-file-tree-row"
				/>
			))}
		</Card>
	)
}

interface GetTreeEntryHrefInput {
	entry: RepositoryTree['entries'][number]
	tree: RepositoryTree
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

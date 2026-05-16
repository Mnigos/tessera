import type { RepositoryBlob } from '@repo/contracts'
import { Card } from '@repo/ui/components/card'
import { formatBytes } from '../helpers/format-tree-entry-size'
import { useRepositoryBlobQuery } from '../hooks/use-repository-blob.query'
import { RepositoryBrowserBreadcrumbs } from './repository-browser-breadcrumbs'
import { RepositoryBrowserMessage } from './repository-browser-message'
import { RepositoryCodeListing } from './repository-code-listing'
import { RepositoryRawBlobAction } from './repository-raw-blob-action'

interface RepositoryBlobPreviewProps {
	username: string
	slug: string
	refName: string
	path: string
}

export function RepositoryBlobPreview({
	username,
	slug,
	refName,
	path,
}: Readonly<RepositoryBlobPreviewProps>) {
	const blobQuery = useRepositoryBlobQuery({
		username,
		slug,
		ref: refName,
		path,
	})

	if (blobQuery.isLoading)
		return (
			<RepositoryBlobShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<Card className="p-0">
					<div className="border-border border-b px-4 py-3">
						<div className="h-4 w-36 animate-pulse rounded bg-muted" />
					</div>
					<div className="p-4">
						<div className="h-48 animate-pulse rounded bg-muted/60" />
					</div>
				</Card>
			</RepositoryBlobShell>
		)

	if (blobQuery.isError)
		return (
			<RepositoryBlobShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="File not found">
					The requested blob could not be loaded.
				</RepositoryBrowserMessage>
			</RepositoryBlobShell>
		)

	if (!blobQuery.data)
		return (
			<RepositoryBlobShell
				path={path}
				refName={refName}
				slug={slug}
				username={username}
			>
				<RepositoryBrowserMessage title="File not found">
					No blob data was returned for this path.
				</RepositoryBrowserMessage>
			</RepositoryBlobShell>
		)

	return (
		<RepositoryBlobShell
			path={blobQuery.data.path}
			refName={blobQuery.data.ref}
			slug={blobQuery.data.repository.slug}
			username={blobQuery.data.owner.username}
		>
			<BlobContent blob={blobQuery.data} />
		</RepositoryBlobShell>
	)
}

interface RepositoryBlobShellProps {
	children: React.ReactNode
	username: string
	slug: string
	refName: string
	path: string
}

function RepositoryBlobShell({
	children,
	username,
	slug,
	refName,
	path,
}: Readonly<RepositoryBlobShellProps>) {
	return (
		<section className="flex flex-col gap-4">
			<header className="flex flex-col gap-3">
				<RepositoryBrowserBreadcrumbs
					path={path}
					refName={refName}
					slug={slug}
					terminalKind="blob"
					username={username}
				/>
				<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
					<span className="rounded-md border border-border px-2 py-1 font-mono">
						{refName}
					</span>
					<span className="min-w-0 truncate">{path}</span>
				</div>
			</header>
			{children}
		</section>
	)
}

interface BlobContentProps {
	blob: RepositoryBlob
}

function BlobContent({ blob }: Readonly<BlobContentProps>) {
	if (blob.preview.type === 'tooLarge')
		return (
			<BlobMessageWithRawAction
				blob={blob}
				title="File is too large to preview"
			>
				Download or clone the repository to inspect this file locally.
			</BlobMessageWithRawAction>
		)

	if (blob.preview.type === 'binary')
		return (
			<BlobMessageWithRawAction blob={blob} title="Binary file">
				This file cannot be previewed as text.
			</BlobMessageWithRawAction>
		)

	if (!blob.preview.content)
		return (
			<BlobMessageWithRawAction blob={blob} title="Empty file">
				This file has no text content.
			</BlobMessageWithRawAction>
		)

	return (
		<Card className="gap-0 overflow-hidden p-0">
			<div className="flex flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-3 text-sm">
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
					<span className="min-w-0 truncate font-medium">{blob.name}</span>
					<BlobLanguage preview={blob.preview} />
					<span className="text-muted-foreground">
						{formatBytes(blob.sizeBytes)}
					</span>
				</div>
				<RepositoryRawBlobAction blob={blob} />
			</div>
			<RepositoryCodeListing blob={{ ...blob, preview: blob.preview }} />
		</Card>
	)
}

interface BlobMessageWithRawActionProps {
	blob: RepositoryBlob
	children: React.ReactNode
	title: string
}

function BlobMessageWithRawAction({
	blob,
	children,
	title,
}: Readonly<BlobMessageWithRawActionProps>) {
	return (
		<div className="flex flex-col gap-3">
			<RepositoryBrowserMessage title={title}>
				{children}
			</RepositoryBrowserMessage>
			<div className="flex justify-start">
				<RepositoryRawBlobAction blob={blob} />
			</div>
		</div>
	)
}

interface HighlightedBlobPreview {
	language?: string
}

interface BlobLanguageProps {
	preview: RepositoryBlob['preview']
}

function BlobLanguage({ preview }: Readonly<BlobLanguageProps>) {
	if (preview.type !== 'text') return null

	const highlightedPreview = preview as typeof preview & HighlightedBlobPreview
	if (!highlightedPreview.language) return null

	return (
		<span className="rounded border border-border px-1.5 py-0.5 font-mono text-muted-foreground text-xs">
			{highlightedPreview.language}
		</span>
	)
}

import { Card } from '@repo/ui/components/card'
import type { RepositoryBlobResult } from '../hooks/use-repository-blob.query'
import { useRepositoryBlobQuery } from '../hooks/use-repository-blob.query'
import { RepositoryBrowserBreadcrumbs } from './repository-browser-breadcrumbs'
import { RepositoryBrowserMessage } from './repository-browser-message'

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
	blob: RepositoryBlobResult
}

function BlobContent({ blob }: Readonly<BlobContentProps>) {
	if (blob.preview.type === 'tooLarge')
		return (
			<RepositoryBrowserMessage title="File is too large to preview">
				Download or clone the repository to inspect this file locally.
			</RepositoryBrowserMessage>
		)

	if (blob.preview.type === 'binary')
		return (
			<RepositoryBrowserMessage title="Binary file">
				This file cannot be previewed as text.
			</RepositoryBrowserMessage>
		)

	if (!blob.preview.content)
		return (
			<RepositoryBrowserMessage title="Empty file">
				This file has no text content.
			</RepositoryBrowserMessage>
		)

	return (
		<Card className="gap-0 overflow-hidden p-0">
			<div className="flex flex-wrap items-center justify-between gap-2 border-border border-b px-4 py-3 text-sm">
				<span className="min-w-0 truncate font-medium">{blob.name}</span>
				<span className="text-muted-foreground">
					{formatBlobSize(blob.sizeBytes)}
				</span>
			</div>
			<pre className="overflow-x-auto p-4 text-sm leading-6">
				<code>{blob.preview.content}</code>
			</pre>
		</Card>
	)
}

function formatBlobSize(sizeBytes: number) {
	if (sizeBytes < 1024) return `${sizeBytes} B`

	const kibibytes = sizeBytes / 1024
	if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KB`

	return `${(kibibytes / 1024).toFixed(1)} MB`
}

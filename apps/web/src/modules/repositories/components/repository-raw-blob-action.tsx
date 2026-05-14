import { FileText } from 'lucide-react'
import type { RepositoryBlobResult } from '../hooks/use-repository-blob.query'

interface RepositoryRawBlobActionProps {
	blob: RepositoryBlobResult
}

export function RepositoryRawBlobAction({
	blob,
}: Readonly<RepositoryRawBlobActionProps>) {
	return (
		<a
			className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 font-medium text-foreground text-xs transition-colors hover:bg-muted"
			href={getRawBlobHref(blob)}
		>
			<FileText aria-hidden="true" className="size-4" />
			Raw
		</a>
	)
}

function getRawBlobHref(blob: RepositoryBlobResult) {
	const basePath = `/repositories/${encodeURIComponent(blob.owner.username)}/${encodeURIComponent(blob.repository.slug)}/raw/${encodeURIComponent(blob.ref)}`
	const searchParams = new URLSearchParams({ path: blob.path })

	return `${basePath}?${searchParams.toString()}`
}

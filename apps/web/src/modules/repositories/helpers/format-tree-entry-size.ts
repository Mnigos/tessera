import type { RepositoryTreeEntry } from '@repo/contracts'

/**
 * Formats repository tree entry sizes for compact file-browser rows.
 */
export function formatTreeEntrySize({
	kind,
	sizeBytes,
}: RepositoryTreeEntry): string {
	if (kind === 'directory') return '-'
	return formatBytes(sizeBytes)
}

export function formatBytes(sizeBytes: number | null | undefined): string {
	if (sizeBytes == null) return '-'
	if (sizeBytes < 1024) return `${sizeBytes} B`

	const kibibytes = sizeBytes / 1024
	if (kibibytes < 1024) return `${kibibytes.toFixed(1)} KB`

	return `${(kibibytes / 1024).toFixed(1)} MB`
}

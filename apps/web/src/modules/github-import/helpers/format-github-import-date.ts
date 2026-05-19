export function formatGitHubImportDate(value: Date | string) {
	const date = value instanceof Date ? value : new Date(value)

	if (Number.isNaN(date.getTime())) return 'unknown'

	return date.toLocaleDateString('en-US', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	})
}

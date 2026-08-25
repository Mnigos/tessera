export function isGitHubImportSourceConflictError(error: unknown) {
	if (!error || typeof error !== 'object' || !('message' in error)) return false

	return String(error.message).includes('github repository import source')
}

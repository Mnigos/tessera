export function isGitHubAccessError(error: unknown) {
	if (!error || typeof error !== 'object') return false
	if ('code' in error && error.code === 'UNAUTHORIZED') return true
	if ('code' in error && error.code === 'FORBIDDEN') return true
	if (
		'message' in error &&
		error.message === 'github import authentication required'
	)
		return true
	if ('message' in error && error.message === 'github import access denied')
		return true

	return 'status' in error && (error.status === 401 || error.status === 403)
}

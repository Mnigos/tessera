import { isGitHubAccessError } from './is-github-access-error'

export function getGitHubImportErrorMessage(
	error: unknown,
	fallback: string
): string {
	if (isGitHubAccessError(error))
		return 'Reconnect GitHub with repository access, then try again.'

	if (error && typeof error === 'object' && 'message' in error) {
		const message = String(error.message)

		if (message.includes('github repository import source'))
			return 'This GitHub repository already has an active import.'
		if (message.includes('github repository import target slug'))
			return 'A repository with this target slug already exists.'
		if (message.includes('github repository import is not retryable'))
			return 'This import is no longer in a failed state. Refresh to see its latest status.'
	}

	return fallback
}

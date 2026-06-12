import { getGitHubImportErrorMessage } from './get-github-import-error-message'

const FALLBACK = 'Could not be queued.'

describe('getGitHubImportErrorMessage', () => {
	test('maps an active source collision', () => {
		expect(
			getGitHubImportErrorMessage(
				new Error('github repository import source already active'),
				FALLBACK
			)
		).toBe('This GitHub repository already has an active import.')
	})

	test('maps a target slug collision', () => {
		expect(
			getGitHubImportErrorMessage(
				new Error('github repository import target slug already exists'),
				FALLBACK
			)
		).toBe('A repository with this target slug already exists.')
	})

	test('maps a not-retryable import', () => {
		expect(
			getGitHubImportErrorMessage(
				new Error('github repository import is not retryable'),
				FALLBACK
			)
		).toBe(
			'This import is no longer in a failed state. Refresh to see its latest status.'
		)
	})

	test.each([
		{ code: 'UNAUTHORIZED' },
		{ code: 'FORBIDDEN' },
		{ status: 401 },
		{ status: 403 },
	])('maps GitHub auth errors to a reconnect message', error => {
		expect(getGitHubImportErrorMessage(error, FALLBACK)).toBe(
			'Reconnect GitHub with repository access, then try again.'
		)
	})

	test('returns the provided fallback for unknown errors', () => {
		expect(
			getGitHubImportErrorMessage(new Error('Internal Server Error'), FALLBACK)
		).toBe(FALLBACK)
	})

	test('returns the provided fallback for non-object errors', () => {
		expect(getGitHubImportErrorMessage(undefined, FALLBACK)).toBe(FALLBACK)
	})
})

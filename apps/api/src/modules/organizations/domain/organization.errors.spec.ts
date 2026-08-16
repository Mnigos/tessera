import {
	GitHubLookupUnavailableError,
	OrganizationDeleteConfirmationError,
	OrganizationHasRepositoriesError,
	OrganizationPermissionDeniedError,
	OrganizationSlugGitHubConflictError,
	OrganizationSlugTakenError,
} from './organization.errors'

describe('organization errors', () => {
	test('uses the public handle-conflict copy', () => {
		expect(new OrganizationSlugTakenError()).toMatchObject({
			code: 'CONFLICT',
			message: 'This handle is already taken by a user or organization.',
		})
		expect(new OrganizationSlugGitHubConflictError('TesseraHQ')).toMatchObject({
			code: 'CONFLICT',
			message:
				'TesseraHQ is an existing GitHub account. Link that GitHub account to your Tessera user to claim it.',
			context: expect.objectContaining({ login: 'TesseraHQ' }),
		})
	})

	test('uses retryable GitHub-unavailable copy', () => {
		expect(new GitHubLookupUnavailableError()).toMatchObject({
			code: 'SERVICE_UNAVAILABLE',
			message:
				"GitHub availability for this handle couldn't be verified. Try again in a moment.",
		})
	})

	test('uses deletion guard copy and context', () => {
		expect(new OrganizationHasRepositoriesError(2)).toMatchObject({
			code: 'CONFLICT',
			message:
				"Transfer or delete the organization's repositories before deleting it.",
			context: expect.objectContaining({ repositoryCount: 2 }),
		})
		expect(new OrganizationDeleteConfirmationError()).toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Type the organization handle to confirm.',
		})
		expect(new OrganizationPermissionDeniedError()).toMatchObject({
			code: 'FORBIDDEN',
		})
	})
})

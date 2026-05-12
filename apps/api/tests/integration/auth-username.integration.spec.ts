import {
	createSuffixedUsername,
	createUsernameSuffix,
	normalizeUsername,
	preserveExistingUsernameOnUpdate,
	resolveGitHubUsername,
} from '@repo/auth/server'

describe('GitHub auth username integration', () => {
	test('persists GitHub login as the preferred normalized username', async () => {
		const username = await resolveGitHubUsername(
			{ id: '123456', login: 'GitHub-User' },
			async () => false
		)

		expect(username).toBe('github-user')
		expect(username).not.toBe('123456')
	})

	test('uses a deterministic suffix when the GitHub login is taken', async () => {
		const takenUsernames = new Set(['github-user'])
		const suffix = createUsernameSuffix('123456')

		const username = await resolveGitHubUsername(
			{ id: '123456', login: 'GitHub User' },
			async candidate => takenUsernames.has(candidate)
		)

		expect(username).toBe(createSuffixedUsername('github-user', suffix))
	})

	test('continues deterministically when the first fallback is also taken', async () => {
		const suffix = createUsernameSuffix('123456')
		const firstFallback = createSuffixedUsername('github-user', suffix)
		const takenUsernames = new Set(['github-user', firstFallback])

		expect(
			await resolveGitHubUsername(
				{ id: '123456', login: 'GitHub User' },
				async candidate => takenUsernames.has(candidate)
			)
		).toBe(createSuffixedUsername('github-user', `${suffix}-02`))
	})

	test('fails when username collision retries are exhausted', async () => {
		await expect(
			resolveGitHubUsername(
				{ id: '123456', login: 'GitHub User' },
				async () => true
			)
		).rejects.toThrow('Failed to resolve a unique username for github-user')
	})

	test('normalizes unsafe URL characters before username persistence', () => {
		expect(normalizeUsername('  GitHub User!!  ')).toBe('github-user')
	})

	test('preserves existing usernames on later sign-ins', () => {
		expect(
			preserveExistingUsernameOnUpdate({
				name: 'Updated Name',
				username: 'next-username',
			})
		).toEqual({
			name: 'Updated Name',
		})
	})
})

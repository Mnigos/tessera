import {
	createSuffixedUsername,
	createUsernameSuffix,
	normalizeUsername,
	preserveExistingUsernameOnUpdate,
	resolveGitHubUsername,
} from './github-username'

describe(normalizeUsername.name, () => {
	test.each([
		['GitHub-User', 'github-user'],
		['  GitHub User!!  ', 'github-user'],
		['Mixed___Separators', 'mixed-separators'],
		['---', 'user'],
		[undefined, 'user'],
	])('normalizes %s to %s', (input, expected) => {
		expect(normalizeUsername(input)).toBe(expected)
	})

	test('trims generated usernames to the Tessera username limit', () => {
		expect(normalizeUsername('a'.repeat(60))).toHaveLength(39)
	})
})

describe(createUsernameSuffix.name, () => {
	test('returns a deterministic six character suffix', () => {
		const suffix = createUsernameSuffix('123456')

		expect(suffix).toHaveLength(6)
		expect(createUsernameSuffix('123456')).toBe(suffix)
	})
})

describe(createSuffixedUsername.name, () => {
	test('keeps suffixed usernames within the Tessera username limit', () => {
		const username = createSuffixedUsername('a'.repeat(60), 'suffix')

		expect(username).toHaveLength(39)
		expect(username.endsWith('-suffix')).toBe(true)
	})

	test('falls back to the default base when trimming removes the whole base', () => {
		expect(createSuffixedUsername('---', 'suffix')).toBe('user-suffix')
	})

	test('trims overlong suffixes to the Tessera username limit', () => {
		expect(createSuffixedUsername('github-user', 's'.repeat(60))).toBe(
			's'.repeat(39)
		)
	})
})

describe(resolveGitHubUsername.name, () => {
	test('prefers an available normalized GitHub login over provider account id', async () => {
		expect(
			await resolveGitHubUsername(
				{ id: '123456', login: 'GitHub-User' },
				async () => false
			)
		).toBe('github-user')
	})

	test('uses a deterministic suffix when the GitHub login is taken', async () => {
		const takenUsernames = new Set(['github-user'])
		const suffix = createUsernameSuffix('123456')

		expect(
			await resolveGitHubUsername(
				{ id: '123456', login: 'GitHub User' },
				async candidate => takenUsernames.has(candidate)
			)
		).toBe(createSuffixedUsername('github-user', suffix))
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
})

describe(preserveExistingUsernameOnUpdate.name, () => {
	test('removes provider username updates when the user already has one', async () => {
		expect(
			await preserveExistingUsernameOnUpdate(
				{
					email: 'github-user@example.com',
					name: 'Updated Name',
					username: 'next-username',
				},
				async () => true
			)
		).toEqual({
			email: 'github-user@example.com',
			name: 'Updated Name',
		})
	})

	test('keeps provider username updates when the user does not have one yet', async () => {
		const updateData = {
			email: 'github-user@example.com',
			name: 'Updated Name',
			username: 'github-user',
		}

		expect(
			await preserveExistingUsernameOnUpdate(updateData, async () => false)
		).toBe(updateData)
	})

	test('removes ambiguous provider username updates without an email lookup key', async () => {
		expect(
			await preserveExistingUsernameOnUpdate(
				{
					name: 'Updated Name',
					username: 'next-username',
				},
				async () => false
			)
		).toEqual({
			name: 'Updated Name',
		})
	})

	test('returns update data unchanged when username is absent', async () => {
		const updateData = { name: 'Updated Name' }

		expect(
			await preserveExistingUsernameOnUpdate(updateData, async () => true)
		).toBe(updateData)
	})
})
